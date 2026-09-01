import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, parsePagination, assertValidTransition } from "../utils.js";
import { logAudit } from "../audit.js";

export const contratosRouter = Router();
contratosRouter.use(requireAuth);
contratosRouter.use(requireRole(...rolesForModule("contratos")));

const STATUSES = ["RASCUNHO", "ENVIADO", "ASSINADO", "CANCELADO"];

// Achado B2 (Fase 5): sequência normal — só avança. CANCELADO é a saída
// de emergência a qualquer momento; depois de ASSINADO, só CANCELADO
// (não é mais possível "desassinar" voltando pra RASCUNHO/ENVIADO).
const STATUS_ORDER = ["RASCUNHO", "ENVIADO", "ASSINADO"];
const STATUS_TERMINAL = ["CANCELADO"];

function pick(body) {
  return {
    clientId: nn(body?.clientId),
    eventId: nn(body?.eventId),
    status: STATUSES.includes(body?.status) ? body.status : "RASCUNHO",
    valueCents: toCents(body?.value),
    content: nn(body?.content),
  };
}

// GET /api/contratos
contratosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select ct.*, c.name as "clientName", e.title as "eventTitle"
      from "Contract" ct
      left join "Client" c on c.id = ct."clientId"
      left join "Event" e on e.id = ct."eventId"
      order by ct."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Contract"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// GET /api/contratos/opcoes
contratosRouter.get(
  "/opcoes",
  asyncHandler(async (req, res) => {
    const [clients, events] = await Promise.all([
      sql`select id, name from "Client" order by name asc`,
      sql`select id, title, "clientId" from "Event" order by "createdAt" desc`,
    ]);
    res.json({ clients, events });
  }),
);

// GET /api/contratos/evento/:eventId/orcamento — orçamento vigente do
// evento (achado: visualização do orçamento a partir do Contrato). Mesmo
// formato "público" (sem custo/margem) da rota de orcamentos.js, mas com o
// papel de Contratos — que inclui FINANCEIRO, sem acesso ao módulo de
// Orçamentos em si. Rota de 3 segmentos: nunca colide com GET "/:id" abaixo.
contratosRouter.get(
  "/evento/:eventId/orcamento",
  asyncHandler(async (req, res) => {
    const [budget] = await sql`
      select b.id, b.number, b.status, b."validUntil", b.notes, b."discountCents", b."createdAt", b."updatedAt",
        c.name as "clientName", e.title as "eventTitle"
      from "Budget" b
      left join "Client" c on c.id = b."clientId"
      left join "Event" e on e.id = b."eventId"
      where b."eventId" = ${req.params.eventId} and b.vigente = true
      limit 1`;
    if (!budget) throw new HttpError(404, "Nenhum orçamento vigente para este evento.");
    const items = await sql`
      select description, quantity, "unitPriceCents" from "BudgetItem"
      where "budgetId" = ${budget.id} order by "id" asc`;
    res.json({ ...budget, items });
  }),
);

// GET /api/contratos/:id
contratosRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [ct] = await sql`
      select ct.*, c.name as "clientName", e.title as "eventTitle"
      from "Contract" ct
      left join "Client" c on c.id = ct."clientId"
      left join "Event" e on e.id = ct."eventId"
      where ct.id = ${req.params.id}`;
    if (!ct) throw new HttpError(404, "Contrato não encontrado.");
    res.json(ct);
  }),
);

// Numeração segura contra concorrência: usa uma sequence do Postgres
// (nextval é atômico) em vez de count(*)+1 — dois usuários criando ao
// mesmo tempo nunca recebem o mesmo número, e excluir um contrato não
// faz o próximo número ser reutilizado. A sequence é criada uma única vez
// por server/setup-numbering.mjs (idempotente).
async function nextNumber() {
  const [{ nextval }] = await sql`select nextval('"Contract_number_seq"') as nextval`;
  return "CT-" + String(nextval).padStart(4, "0");
}

// POST /api/contratos
contratosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pick(req.body));
    data.number = await nextNumber();
    // Achado B18 (Fase 5): "vigente" reflete o status — só um contrato
    // assinado por evento pode estar vigente ao mesmo tempo.
    data.vigente = data.status === "ASSINADO";
    try {
      // Achado B22 (Fase 5): escrita + logAudit na mesma transação.
      const created = await sql.begin(async (tx) => {
        const [c] = await tx`insert into "Contract" ${tx(data)} returning *`;
        await logAudit(tx, { table: "Contract", recordId: c.id, action: "CREATE", user: req.user, before: null, after: c });
        if (c.vigente && c.eventId) {
          await tx`update "Contract" set vigente = false where "eventId" = ${c.eventId} and id <> ${c.id}`;
        }
        return c;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente ou evento selecionado não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/contratos/:id  (assinar → grava signedAt)
contratosRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const [current] = await sql`select * from "Contract" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Contrato não encontrado.");
    assertValidTransition(current.status, data.status, { order: STATUS_ORDER, terminal: STATUS_TERMINAL });
    const signedAt =
      data.status === "ASSINADO"
        ? current.signedAt || new Date()
        : data.status === "RASCUNHO" || data.status === "CANCELADO"
          ? null
          : current.signedAt;
    // Achado B18 (Fase 5): "vigente" reflete o status — só um contrato
    // assinado por evento pode estar vigente ao mesmo tempo.
    data.vigente = data.status === "ASSINADO";
    try {
      const updated = await sql.begin(async (tx) => {
        const [u] = await tx`
          update "Contract" set ${tx(data)}, "signedAt" = ${signedAt}, "updatedAt" = now()
          where id = ${req.params.id} returning *`;
        await logAudit(tx, { table: "Contract", recordId: u.id, action: "UPDATE", user: req.user, before: current, after: u });
        if (u.vigente && u.eventId) {
          await tx`update "Contract" set vigente = false where "eventId" = ${u.eventId} and id <> ${u.id}`;
        }
        return u;
      });
      res.json(updated);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente ou evento selecionado não existe mais.");
      throw e;
    }
  }),
);

// DELETE /api/contratos/:id
contratosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [deleted] = await tx`delete from "Contract" where id = ${req.params.id} returning *`;
      if (!deleted) throw new HttpError(404, "Contrato não encontrado.");
      await logAudit(tx, { table: "Contract", recordId: deleted.id, action: "DELETE", user: req.user, before: deleted, after: null });
    });
    res.json({ ok: true });
  }),
);
