import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, parsePagination } from "../utils.js";

export const clientesRouter = Router();
clientesRouter.use(requireAuth);
clientesRouter.use(requireRole(...rolesForModule("crm")));

// Campos aceitos no cliente (evita gravar coluna indevida).
const FIELDS = [
  "personType", "name", "tradeName", "document", "email", "phone",
  "zipCode", "street", "number", "complement", "district", "city", "state", "notes",
];

function pick(body) {
  const data = {};
  for (const f of FIELDS) data[f] = nn(body?.[f]);
  if (!data.name) throw new HttpError(400, "Informe o nome / razão social.");
  data.personType = data.personType || "PF";
  return data;
}

// Achado B8 (Fase 5) — CRUD de Contact (contatos do cliente): antes só era
// lido (embutido em GET /:id), sem nenhuma rota para criar/editar/excluir.
function pickContact(body) {
  const name = nn(body?.name) ? String(body.name).trim() : null;
  if (!name) throw new HttpError(400, "Informe o nome do contato.");
  const primary = body?.primary === true || body?.primary === "true";
  return { name, primary };
}

// GET /api/clientes?q=
clientesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : null;
    const whereClause = q ? sql`where c.name ilike ${q} or c.document ilike ${q} or c.email ilike ${q}` : sql``;
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select c.*,
        (select count(*)::int from "Opportunity" o where o."clientId" = c.id) as opportunities,
        (select count(*)::int from "Event" e where e."clientId" = c.id) as events
      from "Client" c
      ${whereClause}
      order by c.name asc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Client" c ${whereClause}`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// GET /api/clientes/:id
clientesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [client] = await sql`select * from "Client" where id = ${req.params.id}`;
    if (!client) throw new HttpError(404, "Cliente não encontrado.");
    const contacts = await sql`
      select * from "Contact" where "clientId" = ${client.id}
      order by "primary" desc, name asc`;
    const opportunities = await sql`
      select id, title, stage, "estimatedCents" from "Opportunity"
      where "clientId" = ${client.id} order by "updatedAt" desc`;
    const events = await sql`
      select id, title, status, "eventDate" from "Event"
      where "clientId" = ${client.id} order by "createdAt" desc limit 10`;
    res.json({ ...client, contacts, opportunities, events });
  }),
);

// POST /api/clientes
clientesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pick(req.body));
    // Achado B3 (Fase 5): documento (CPF/CNPJ) duplicado — o banco
    // rejeita com 23505 (índice único condicional, só quando document
    // não é nulo — ver server/setup-status-rules.mjs).
    try {
      const [created] = await sql`insert into "Client" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23505") throw new HttpError(400, "Já existe um cliente com esse CPF/CNPJ.");
      throw e;
    }
  }),
);

// PUT /api/clientes/:id
clientesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    let updated;
    try {
      [updated] = await sql`
        update "Client" set ${sql(data)}, "updatedAt" = now()
        where id = ${req.params.id} returning *`;
    } catch (e) {
      if (e.code === "23505") throw new HttpError(400, "Já existe um cliente com esse CPF/CNPJ.");
      throw e;
    }
    if (!updated) throw new HttpError(404, "Cliente não encontrado.");
    res.json(updated);
  }),
);

// DELETE /api/clientes/:id
clientesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Client" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Cliente não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: este cliente está vinculado a outros registros (leads, oportunidades, eventos, orçamentos ou contratos).",
        );
      throw e;
    }
  }),
);

// ---- Contatos do cliente (achado B8, Fase 5) ----

// "primary" é um marcador de "contato principal" por cliente — no máximo
// um por vez, mesmo padrão já usado em SupplierProduct.isDefault
// (server/routes/catalogo.js): marcar um como principal desmarca os outros
// do mesmo cliente, em vez de permitir vários "principais" ao mesmo tempo.
async function clearOtherPrimaryContacts(clientId, exceptId) {
  await sql`
    update "Contact" set "primary" = false
    where "clientId" = ${clientId} and id <> ${exceptId}`;
}

// POST /api/clientes/:clientId/contatos
clientesRouter.post(
  "/:clientId/contatos",
  asyncHandler(async (req, res) => {
    const data = pickContact(req.body);
    const contact = prepInsert({ clientId: req.params.clientId, ...data }, { updatedAt: false });
    delete contact.createdAt; // Contact não tem createdAt/updatedAt
    try {
      const [created] = await sql`insert into "Contact" ${sql(contact)} returning *`;
      if (data.primary) await clearOtherPrimaryContacts(req.params.clientId, created.id);
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503") throw new HttpError(400, "Cliente selecionado não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/clientes/contatos/:id
clientesRouter.put(
  "/contatos/:id",
  asyncHandler(async (req, res) => {
    const data = pickContact(req.body);
    const [updated] = await sql`
      update "Contact" set ${sql(data)} where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Contato não encontrado.");
    if (data.primary) await clearOtherPrimaryContacts(updated.clientId, updated.id);
    res.json(updated);
  }),
);

// DELETE /api/clientes/contatos/:id
clientesRouter.delete(
  "/contatos/:id",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "Contact" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Contato não encontrado.");
    res.json({ ok: true });
  }),
);
