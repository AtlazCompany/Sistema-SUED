import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, toDateOrNull, parsePagination, assertValidTransition } from "../utils.js";

export const oportunidadesRouter = Router();
oportunidadesRouter.use(requireAuth);
oportunidadesRouter.use(requireRole(...rolesForModule("crm")));

const STAGES = ["PROSPECCAO", "QUALIFICACAO", "PROPOSTA", "NEGOCIACAO", "GANHO", "PERDIDO"];
const TYPES = ["LIGACAO", "REUNIAO", "EMAIL", "WHATSAPP", "NOTA", "VISITA"];

// Achado B2 (Fase 5): sequência normal do funil — só avança (pular
// etapas é permitido). GANHO/PERDIDO são as duas saídas definitivas,
// alcançáveis a partir de qualquer estágio ativo; nenhuma mudança de
// estágio depois de uma oportunidade ganha ou perdida.
const STAGE_ORDER = ["PROSPECCAO", "QUALIFICACAO", "PROPOSTA", "NEGOCIACAO"];
const STAGE_TERMINAL = ["GANHO", "PERDIDO"];

function pick(body) {
  const data = {
    title: nn(body?.title),
    clientId: nn(body?.clientId),
    ownerId: nn(body?.ownerId),
    stage: STAGES.includes(body?.stage) ? body.stage : "PROSPECCAO",
    estimatedCents: toCents(body?.estimated),
    expectedDate: toDateOrNull(body?.expectedDate, "Data prevista"),
    notes: nn(body?.notes),
  };
  if (!data.title) throw new HttpError(400, "Informe um título.");
  if (!data.clientId) throw new HttpError(400, "Selecione um cliente.");
  return data;
}

// GET /api/oportunidades — agrupáveis por estágio no front (funil usa a
// lista inteira, por isso a paginação aqui é só opt-in — sem "page"/
// "pageSize" na query, continua vindo tudo, como o funil precisa).
oportunidadesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select o.*, c.name as "clientName", u.name as "ownerName"
      from "Opportunity" o
      join "Client" c on c.id = o."clientId"
      left join "User" u on u.id = o."ownerId"
      order by o."updatedAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Opportunity"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// GET /api/oportunidades/:id — detalhe com interações.
oportunidadesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [opp] = await sql`
      select o.*, c.name as "clientName", u.name as "ownerName"
      from "Opportunity" o
      join "Client" c on c.id = o."clientId"
      left join "User" u on u.id = o."ownerId"
      where o.id = ${req.params.id}`;
    if (!opp) throw new HttpError(404, "Oportunidade não encontrada.");
    const interactions = await sql`
      select i.*, u.name as "userName"
      from "Interaction" i
      left join "User" u on u.id = i."userId"
      where i."opportunityId" = ${opp.id}
      order by i."createdAt" desc`;
    res.json({ ...opp, interactions });
  }),
);

// POST /api/oportunidades
oportunidadesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pick(req.body));
    try {
      const [created] = await sql`insert into "Opportunity" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente ou responsável selecionado não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/oportunidades/:id
oportunidadesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    // Achado B2 (Fase 5): mesma validação de transição do PATCH /estagio —
    // aplicada aqui também para que editar pelo formulário geral não seja
    // uma forma de contornar a regra do funil.
    const [current] = await sql`select stage from "Opportunity" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Oportunidade não encontrada.");
    assertValidTransition(current.stage, data.stage, { order: STAGE_ORDER, terminal: STAGE_TERMINAL }, "estágio");
    try {
      const [updated] = await sql`
        update "Opportunity" set ${sql(data)}, "updatedAt" = now()
        where id = ${req.params.id} returning *`;
      if (!updated) throw new HttpError(404, "Oportunidade não encontrada.");
      res.json(updated);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente ou responsável selecionado não existe mais.");
      throw e;
    }
  }),
);

// PATCH /api/oportunidades/:id/estagio — mover no funil.
oportunidadesRouter.patch(
  "/:id/estagio",
  asyncHandler(async (req, res) => {
    const stage = req.body?.stage;
    if (!STAGES.includes(stage)) throw new HttpError(400, "Estágio inválido.");
    const [current] = await sql`select stage from "Opportunity" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Oportunidade não encontrada.");
    assertValidTransition(current.stage, stage, { order: STAGE_ORDER, terminal: STAGE_TERMINAL }, "estágio");
    const [updated] = await sql`
      update "Opportunity" set stage = ${stage}, "updatedAt" = now()
      where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Oportunidade não encontrada.");
    res.json(updated);
  }),
);

// DELETE /api/oportunidades/:id
oportunidadesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Opportunity" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Oportunidade não encontrada.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: esta oportunidade está vinculada a um evento. Marque-a como perdida em vez de excluir.",
        );
      throw e;
    }
  }),
);

// POST /api/oportunidades/:id/interacoes — registrar contato no histórico.
oportunidadesRouter.post(
  "/:id/interacoes",
  asyncHandler(async (req, res) => {
    const content = nn(req.body?.content);
    if (!content) throw new HttpError(400, "Descreva a interação.");
    const type = TYPES.includes(req.body?.type) ? req.body.type : "NOTA";

    // Interaction não tem coluna updatedAt.
    const data = prepInsert(
      { type, content, opportunityId: req.params.id, userId: req.user.id },
      { updatedAt: false },
    );
    try {
      const [created] = await sql`insert into "Interaction" ${sql(data)} returning *`;
      res.status(201).json({ ...created, userName: req.user.name });
    } catch (e) {
      if (e.code === "23503") throw new HttpError(400, "Oportunidade selecionada não existe mais.");
      throw e;
    }
  }),
);
