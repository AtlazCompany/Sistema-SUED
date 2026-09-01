import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { ROLE_MODULES } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn } from "../utils.js";
import { logAudit } from "../audit.js";

export const usuariosRouter = Router();
usuariosRouter.use(requireAuth);

// GET /api/usuarios/opcoes — lista leve para selects (responsáveis). Continua
// aberta a qualquer papel autenticado — é transversal, não é o módulo de
// gestão de usuários (registrada ANTES do requireRole abaixo, então nunca
// passa por ele: o handler responde e a cadeia não segue adiante).
usuariosRouter.get(
  "/opcoes",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select id, name, role from "User"
      where active = true order by name asc`;
    res.json(rows);
  }),
);

// A partir daqui: gestão de usuários — só ADMIN/SOCIO (módulo "usuarios").
usuariosRouter.use(requireRole(...rolesForModule("usuarios")));

const VALID_ROLES = Object.keys(ROLE_MODULES);
// Papéis com poder de gestão de usuários — hoje ADMIN e SOCIO têm o mesmo
// acesso em toda a matriz (ROLE_MODULES.SOCIO === ROLE_MODULES.ADMIN), então
// tratamos os dois como "administradores" para a regra de "não remover o
// último administrador ativo" abaixo.
const ADMIN_ROLES = ["ADMIN", "SOCIO"];

// Checagem simples de formato (não é validação exaustiva de RFC 5322) —
// só o suficiente para rejeitar valores obviamente inválidos, consistente
// com o resto do projeto (sem biblioteca nova para isso).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pick(body) {
  const name = nn(body?.name) ? String(body.name).trim() : null;
  const email = nn(body?.email) ? String(body.email).trim().toLowerCase() : null;
  const role = body?.role;
  if (!name) throw new HttpError(400, "Informe o nome.");
  if (!email) throw new HttpError(400, "Informe o e-mail.");
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "E-mail inválido.");
  if (!VALID_ROLES.includes(role)) throw new HttpError(400, "Papel inválido.");
  return { name, email, role };
}

function pickPassword(body) {
  const password = body?.password;
  if (!password || String(password).length < 8)
    throw new HttpError(400, "A senha deve ter pelo menos 8 caracteres.");
  return String(password);
}

async function countOtherActiveAdmins(excludeId) {
  const [{ n }] = await sql`
    select count(*)::int as n from "User"
    where active = true and role = any(${ADMIN_ROLES}) and id <> ${excludeId}`;
  return n;
}

// GET /api/usuarios — lista completa (nunca inclui passwordHash).
usuariosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await sql`select id, name, email, role, active from "User" order by name asc`;
    res.json(rows);
  }),
);

// POST /api/usuarios — criar usuário.
usuariosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const password = pickPassword(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();
    try {
      // Achado B22 (Fase 5): escrita principal + logAudit na MESMA transação
      // — mesma recomendação técnica já aprovada no B9 ("o log nunca perde
      // um evento"), que tinha ficado sem seguir em 9 das 11 rotas
      // instrumentadas originalmente.
      const created = await sql.begin(async (tx) => {
        const [c] = await tx`
          insert into "User" ${tx({ id, ...data, active: true, passwordHash })}
          returning id, name, email, role, active`;
        await logAudit(tx, { table: "User", recordId: c.id, action: "CREATE", user: req.user, before: null, after: c });
        return c;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "Já existe um usuário com esse e-mail.");
      throw e;
    }
  }),
);

// PUT /api/usuarios/:id — editar nome/e-mail/papel/ativo.
usuariosRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const active = req.body?.active !== false && req.body?.active !== "false";
    const isSelf = req.params.id === req.user.id;

    if (isSelf && (data.role !== req.user.role || active !== true))
      throw new HttpError(400, "Você não pode alterar seu próprio papel ou se desativar.");

    // Buscado incondicionalmente (antes só quando a checagem de último
    // administrador se aplicava) — agora também serve de snapshot "antes"
    // para a trilha de auditoria (achado B9).
    const [current] = await sql`select id, name, email, role, active from "User" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Usuário não encontrado.");

    if (!active || !ADMIN_ROLES.includes(data.role)) {
      const wasAdminActive = current.active && ADMIN_ROLES.includes(current.role);
      const staysAdminActive = active && ADMIN_ROLES.includes(data.role);
      if (wasAdminActive && !staysAdminActive) {
        const remaining = await countOtherActiveAdmins(req.params.id);
        if (remaining === 0)
          throw new HttpError(400, "Não é possível remover o último administrador/sócio ativo.");
      }
    }

    try {
      const updated = await sql.begin(async (tx) => {
        const [u] = await tx`
          update "User" set ${tx({ ...data, active })}
          where id = ${req.params.id} returning id, name, email, role, active`;
        await logAudit(tx, { table: "User", recordId: u.id, action: "UPDATE", user: req.user, before: current, after: u });
        return u;
      });
      res.json(updated);
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "Já existe um usuário com esse e-mail.");
      throw e;
    }
  }),
);

// POST /api/usuarios/:id/redefinir-senha — ADMIN/SOCIO redefine a senha de
// outro usuário (não exige a senha atual — quem está autorizado aqui já
// passou pelo requireRole acima).
usuariosRouter.post(
  "/:id/redefinir-senha",
  asyncHandler(async (req, res) => {
    const password = pickPassword(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    // Achado B7 (Fase 5): incrementa tokenVersion junto — a sessão que a
    // pessoa já tinha aberta (se houver) para de funcionar na próxima
    // requisição dela, mesmo sem exigir a senha antiga aqui (é exatamente
    // o admin quem está forçando a redefinição, ex.: suspeita de conta
    // comprometida).
    const updated = await sql.begin(async (tx) => {
      const [u] = await tx`
        update "User" set "passwordHash" = ${passwordHash}, "tokenVersion" = "tokenVersion" + 1
        where id = ${req.params.id} returning id`;
      if (!u) throw new HttpError(404, "Usuário não encontrado.");
      // before/after ficam null de propósito: os únicos campos alterados aqui
      // (passwordHash, tokenVersion) nunca devem ir para a trilha — o próprio
      // registro (quem fez, em qual usuário, quando) já é o valor de auditoria.
      await logAudit(tx, { table: "User", recordId: u.id, action: "UPDATE", user: req.user, before: null, after: null });
      return u;
    });
    res.json({ ok: true });
  }),
);

// DELETE /api/usuarios/:id
usuariosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id)
      throw new HttpError(400, "Você não pode excluir sua própria conta.");

    const [current] = await sql`select id, name, email, role, active from "User" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Usuário não encontrado.");

    if (current.active && ADMIN_ROLES.includes(current.role)) {
      const remaining = await countOtherActiveAdmins(req.params.id);
      if (remaining === 0)
        throw new HttpError(400, "Não é possível excluir o último administrador/sócio ativo.");
    }

    try {
      await sql.begin(async (tx) => {
        await tx`delete from "User" where id = ${req.params.id}`;
        await logAudit(tx, { table: "User", recordId: current.id, action: "DELETE", user: req.user, before: current, after: null });
      });
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: este usuário está vinculado a outros registros (eventos, tarefas, oportunidades…). Desative-o em vez de excluir.",
        );
      throw e;
    }
  }),
);
