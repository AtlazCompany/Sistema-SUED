import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, toDateOrNull, parsePagination, assertValidTransition } from "../utils.js";

export const orcamentosRouter = Router();
orcamentosRouter.use(requireAuth);
orcamentosRouter.use(requireRole(...rolesForModule("orcamentos")));

const STATUSES = ["RASCUNHO", "ENVIADO", "APROVADO", "REJEITADO", "EXPIRADO"];

// Achado B2 (Fase 5): sequência normal — só avança. APROVADO/REJEITADO/
// EXPIRADO são saídas definitivas, alcançáveis a partir de RASCUNHO ou
// ENVIADO; nenhuma mudança de status depois delas.
const STATUS_ORDER = ["RASCUNHO", "ENVIADO"];
const STATUS_TERMINAL = ["APROVADO", "REJEITADO", "EXPIRADO"];

function pickHeader(body) {
  return {
    clientId: nn(body?.clientId),
    eventId: nn(body?.eventId),
    opportunityId: nn(body?.opportunityId),
    status: STATUSES.includes(body?.status) ? body.status : "RASCUNHO",
    validUntil: toDateOrNull(body?.validUntil, "Válido até"),
    discountCents: toCents(body?.discount),
    notes: nn(body?.notes),
  };
}

function pickItems(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items
    .filter((i) => nn(i?.description))
    .map((i) => ({
      productServiceId: nn(i.productServiceId),
      description: String(i.description).trim(),
      quantity: Math.max(1, Number(i.quantity) || 1),
      unitPriceCents: toCents(i.unitPrice),
      unitCostCents: toCents(i.unitCost),
    }));
}

// Achado B5 (Fase 5): desconto não pode ultrapassar o subtotal calculado
// dos próprios itens sendo salvos — evita um orçamento com total
// negativo indo pro cliente.
function assertDiscountWithinSubtotal(items, discountCents) {
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPriceCents, 0);
  if (discountCents > subtotal)
    throw new HttpError(400, "O desconto não pode ser maior que o subtotal do orçamento.");
}

// Totais (subquery reutilizada na listagem)
const totalsSelect = sql`
  coalesce((select sum(bi.quantity * bi."unitPriceCents") from "BudgetItem" bi where bi."budgetId" = b.id), 0)::bigint as subtotal,
  coalesce((select sum(bi.quantity * bi."unitCostCents") from "BudgetItem" bi where bi."budgetId" = b.id), 0)::bigint as "costTotal"`;

// GET /api/orcamentos
orcamentosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select b.*, c.name as "clientName", e.title as "eventTitle", ${totalsSelect}
      from "Budget" b
      left join "Client" c on c.id = b."clientId"
      left join "Event" e on e.id = b."eventId"
      order by b."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Budget"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// GET /api/orcamentos/opcoes — clientes, eventos e catálogo p/ montar itens.
orcamentosRouter.get(
  "/opcoes",
  asyncHandler(async (req, res) => {
    const [clients, events, catalog] = await Promise.all([
      sql`select id, name from "Client" order by name asc`,
      sql`select id, title from "Event" order by "createdAt" desc`,
      sql`
        select id, name, unit, "referenceCostCents", "suggestedPriceCents"
        from "ProductService" where active = true order by name asc`,
    ]);
    res.json({ clients, events, catalog });
  }),
);

// GET /api/orcamentos/:id — com itens.
orcamentosRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [budget] = await sql`
      select b.*, c.name as "clientName", e.title as "eventTitle"
      from "Budget" b
      left join "Client" c on c.id = b."clientId"
      left join "Event" e on e.id = b."eventId"
      where b.id = ${req.params.id}`;
    if (!budget) throw new HttpError(404, "Orçamento não encontrado.");
    const items = await sql`
      select * from "BudgetItem" where "budgetId" = ${budget.id} order by "id" asc`;
    res.json({ ...budget, items });
  }),
);

// Numeração segura contra concorrência: usa uma sequence do Postgres
// (nextval é atômico) em vez de count(*)+1 — dois usuários criando ao
// mesmo tempo nunca recebem o mesmo número, e excluir um orçamento não
// faz o próximo número ser reutilizado. A sequence é criada uma única vez
// por server/setup-numbering.mjs (idempotente).
async function nextNumber() {
  const [{ nextval }] = await sql`select nextval('"Budget_number_seq"') as nextval`;
  return "ORC-" + String(nextval).padStart(4, "0");
}

// POST /api/orcamentos  (cria cabeçalho + itens numa transação)
orcamentosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const header = prepInsert(pickHeader(req.body));
    header.number = await nextNumber();
    const items = pickItems(req.body);
    assertDiscountWithinSubtotal(items, header.discountCents);
    // Achado B18 (Fase 5): "vigente" reflete o status — só um orçamento
    // aprovado por evento pode estar vigente ao mesmo tempo.
    header.vigente = header.status === "APROVADO";

    try {
      const created = await sql.begin(async (tx) => {
        const [b] = await tx`insert into "Budget" ${tx(header)} returning *`;
        for (const it of items) {
          await tx`insert into "BudgetItem" ${tx({ ...prepInsertItem(), budgetId: b.id, ...it })}`;
        }
        if (b.vigente && b.eventId) {
          await tx`update "Budget" set vigente = false where "eventId" = ${b.eventId} and id <> ${b.id}`;
        }
        return b;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente, evento, oportunidade ou item do catálogo selecionado não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/orcamentos/:id  (atualiza cabeçalho + substitui itens)
orcamentosRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const header = pickHeader(req.body);
    const items = pickItems(req.body);
    assertDiscountWithinSubtotal(items, header.discountCents);

    const [current] = await sql`select status from "Budget" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Orçamento não encontrado.");
    assertValidTransition(current.status, header.status, { order: STATUS_ORDER, terminal: STATUS_TERMINAL });
    // Achado B18 (Fase 5): "vigente" reflete o status — só um orçamento
    // aprovado por evento pode estar vigente ao mesmo tempo.
    header.vigente = header.status === "APROVADO";

    try {
      const updated = await sql.begin(async (tx) => {
        const [b] = await tx`
          update "Budget" set ${tx(header)}, "updatedAt" = now()
          where id = ${req.params.id} returning *`;
        if (!b) throw new HttpError(404, "Orçamento não encontrado.");
        await tx`delete from "BudgetItem" where "budgetId" = ${b.id}`;
        for (const it of items) {
          await tx`insert into "BudgetItem" ${tx({ ...prepInsertItem(), budgetId: b.id, ...it })}`;
        }
        if (b.vigente && b.eventId) {
          await tx`update "Budget" set vigente = false where "eventId" = ${b.eventId} and id <> ${b.id}`;
        }
        return b;
      });
      res.json(updated);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Cliente, evento, oportunidade ou item do catálogo selecionado não existe mais.");
      throw e;
    }
  }),
);

// DELETE /api/orcamentos/:id
orcamentosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await sql`delete from "BudgetItem" where "budgetId" = ${req.params.id}`;
    const [deleted] = await sql`delete from "Budget" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Orçamento não encontrado.");
    res.json({ ok: true });
  }),
);

// BudgetItem só precisa de id (sem createdAt/updatedAt no schema).
function prepInsertItem() {
  const { id } = prepInsert({}, { updatedAt: false });
  return { id };
}
