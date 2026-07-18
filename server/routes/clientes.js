import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth } from "../auth.js";
import { asyncHandler, HttpError, nn, prepInsert } from "../utils.js";

export const clientesRouter = Router();
clientesRouter.use(requireAuth);

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

// GET /api/clientes?q=
clientesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : null;
    const rows = q
      ? await sql`
          select c.*,
            (select count(*)::int from "Opportunity" o where o."clientId" = c.id) as opportunities,
            (select count(*)::int from "Event" e where e."clientId" = c.id) as events
          from "Client" c
          where c.name ilike ${q} or c.document ilike ${q} or c.email ilike ${q}
          order by c.name asc`
      : await sql`
          select c.*,
            (select count(*)::int from "Opportunity" o where o."clientId" = c.id) as opportunities,
            (select count(*)::int from "Event" e where e."clientId" = c.id) as events
          from "Client" c
          order by c.name asc`;
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
    const [created] = await sql`insert into "Client" ${sql(data)} returning *`;
    res.status(201).json(created);
  }),
);

// PUT /api/clientes/:id
clientesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const [updated] = await sql`
      update "Client" set ${sql(data)}, "updatedAt" = now()
      where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Cliente não encontrado.");
    res.json(updated);
  }),
);

// DELETE /api/clientes/:id
clientesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await sql`delete from "Client" where id = ${req.params.id}`;
    res.json({ ok: true });
  }),
);
