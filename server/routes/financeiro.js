import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, toDateOrNull, withId, parsePagination } from "../utils.js";
import { logAudit } from "../audit.js";

export const financeiroRouter = Router();
financeiroRouter.use(requireAuth);
financeiroRouter.use(requireRole(...rolesForModule("financeiro")));

// GET /api/financeiro/opcoes
financeiroRouter.get(
  "/opcoes",
  asyncHandler(async (req, res) => {
    const [events, suppliers] = await Promise.all([
      sql`select id, title from "Event" order by "createdAt" desc`,
      sql`select id, name from "Supplier" order by name asc`,
    ]);
    res.json({ events, suppliers });
  }),
);

// GET /api/financeiro/resumo — KPIs + fluxo do mês.
financeiroRouter.get(
  "/resumo",
  asyncHandler(async (req, res) => {
    const [[receber], [pagar], [entradas], [saidas], [atrasadas]] = await Promise.all([
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "AccountReceivable" where status = 'PENDENTE'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "AccountPayable" where status = 'PENDENTE'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "Transaction" where kind = 'ENTRADA'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "Transaction" where kind = 'SAIDA'`,
      sql`select count(*)::int as n from "AccountReceivable" where status = 'PENDENTE' and "dueDate" < now()`,
    ]);
    res.json({
      aReceberCents: Number(receber.v),
      aPagarCents: Number(pagar.v),
      entradasCents: Number(entradas.v),
      saidasCents: Number(saidas.v),
      saldoCents: Number(entradas.v) - Number(saidas.v),
      atrasadas: atrasadas.n,
    });
  }),
);

// ---- Contas a receber ----
financeiroRouter.get(
  "/receber",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select r.*, e.title as "eventTitle"
      from "AccountReceivable" r left join "Event" e on e.id = r."eventId"
      order by r."dueDate" asc nulls last, r."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "AccountReceivable"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

financeiroRouter.post(
  "/receber",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!nn(b.description)) throw new HttpError(400, "Informe a descrição.");
    const amountCents = toCents(b.amount);
    // Achado B4 (Fase 5): valor não pode ser negativo nem zero.
    if (amountCents <= 0) throw new HttpError(400, "O valor deve ser maior que zero.");
    const data = prepInsert({
      description: b.description.trim(),
      eventId: nn(b.eventId),
      amountCents,
      dueDate: toDateOrNull(b.dueDate, "Data de vencimento"),
      status: "PENDENTE",
    });
    try {
      // Achado B22 (Fase 5): escrita + logAudit na mesma transação.
      const created = await sql.begin(async (tx) => {
        const [c] = await tx`insert into "AccountReceivable" ${tx(data)} returning *`;
        await logAudit(tx, { table: "AccountReceivable", recordId: c.id, action: "CREATE", user: req.user, before: null, after: c });
        return c;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Evento selecionado não existe mais.");
      throw e;
    }
  }),
);

// Marcar como recebido → cria Transaction (ENTRADA) e soma no realizado do evento.
financeiroRouter.post(
  "/receber/:id/receber",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [r] = await tx`select * from "AccountReceivable" where id = ${req.params.id}`;
      if (!r) throw new HttpError(404, "Conta não encontrada.");
      if (r.status === "RECEBIDO") return;
      const [updated] = await tx`update "AccountReceivable" set status = 'RECEBIDO', "receivedDate" = now(), "updatedAt" = now() where id = ${r.id} returning *`;
      await tx`insert into "Transaction" ${tx(withId({
        kind: "ENTRADA", description: r.description, amountCents: r.amountCents,
        date: new Date(), eventId: r.eventId,
      }))}`;
      if (r.eventId) await tx`update "Event" set "actualRevenueCents" = "actualRevenueCents" + ${r.amountCents}, "updatedAt" = now() where id = ${r.eventId}`;
      await logAudit(tx, { table: "AccountReceivable", recordId: r.id, action: "UPDATE", user: req.user, before: r, after: updated });
    });
    res.json({ ok: true });
  }),
);

financeiroRouter.delete(
  "/receber/:id",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [deleted] = await tx`delete from "AccountReceivable" where id = ${req.params.id} returning *`;
      if (!deleted) throw new HttpError(404, "Conta a receber não encontrada.");
      await logAudit(tx, { table: "AccountReceivable", recordId: deleted.id, action: "DELETE", user: req.user, before: deleted, after: null });
    });
    res.json({ ok: true });
  }),
);

// ---- Contas a pagar ----
financeiroRouter.get(
  "/pagar",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select p.*, e.title as "eventTitle", s.name as "supplierName"
      from "AccountPayable" p
      left join "Event" e on e.id = p."eventId"
      left join "Supplier" s on s.id = p."supplierId"
      order by p."dueDate" asc nulls last, p."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "AccountPayable"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

financeiroRouter.post(
  "/pagar",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!nn(b.description)) throw new HttpError(400, "Informe a descrição.");
    const amountCents = toCents(b.amount);
    // Achado B4 (Fase 5): valor não pode ser negativo nem zero.
    if (amountCents <= 0) throw new HttpError(400, "O valor deve ser maior que zero.");
    const data = prepInsert({
      description: b.description.trim(),
      eventId: nn(b.eventId),
      supplierId: nn(b.supplierId),
      amountCents,
      dueDate: toDateOrNull(b.dueDate, "Data de vencimento"),
      status: "PENDENTE",
    });
    try {
      const created = await sql.begin(async (tx) => {
        const [c] = await tx`insert into "AccountPayable" ${tx(data)} returning *`;
        await logAudit(tx, { table: "AccountPayable", recordId: c.id, action: "CREATE", user: req.user, before: null, after: c });
        return c;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Evento ou fornecedor selecionado não existe mais.");
      throw e;
    }
  }),
);

// Marcar como pago → Transaction (SAIDA) e soma no custo realizado do evento.
financeiroRouter.post(
  "/pagar/:id/pagar",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [p] = await tx`select * from "AccountPayable" where id = ${req.params.id}`;
      if (!p) throw new HttpError(404, "Conta não encontrada.");
      if (p.status === "PAGO") return;
      const [updated] = await tx`update "AccountPayable" set status = 'PAGO', "paidDate" = now(), "updatedAt" = now() where id = ${p.id} returning *`;
      await tx`insert into "Transaction" ${tx(withId({
        kind: "SAIDA", description: p.description, amountCents: p.amountCents,
        date: new Date(), eventId: p.eventId,
      }))}`;
      if (p.eventId) await tx`update "Event" set "actualCostCents" = "actualCostCents" + ${p.amountCents}, "updatedAt" = now() where id = ${p.eventId}`;
      await logAudit(tx, { table: "AccountPayable", recordId: p.id, action: "UPDATE", user: req.user, before: p, after: updated });
    });
    res.json({ ok: true });
  }),
);

financeiroRouter.delete(
  "/pagar/:id",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [deleted] = await tx`delete from "AccountPayable" where id = ${req.params.id} returning *`;
      if (!deleted) throw new HttpError(404, "Conta a pagar não encontrada.");
      await logAudit(tx, { table: "AccountPayable", recordId: deleted.id, action: "DELETE", user: req.user, before: deleted, after: null });
    });
    res.json({ ok: true });
  }),
);

// ---- Fluxo de caixa ----
financeiroRouter.get(
  "/fluxo",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select t.*, e.title as "eventTitle"
      from "Transaction" t left join "Event" e on e.id = t."eventId"
      order by t.date desc limit 100`;
    res.json(rows);
  }),
);
