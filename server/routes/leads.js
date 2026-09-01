import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, parsePagination } from "../utils.js";

export const leadsRouter = Router();
leadsRouter.use(requireAuth);
leadsRouter.use(requireRole(...rolesForModule("crm")));

const FIELDS = ["name", "company", "email", "phone", "source", "status", "notes"];
const STATUSES = ["NOVO", "EM_CONTATO", "QUALIFICADO", "CONVERTIDO", "PERDIDO"];

function pick(body) {
  const data = {};
  for (const f of FIELDS) data[f] = nn(body?.[f]);
  if (!data.name) throw new HttpError(400, "Informe o nome do lead.");
  data.status = STATUSES.includes(data.status) ? data.status : "NOVO";
  return data;
}

// GET /api/leads
leadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select l.*, c.name as "clientName"
      from "Lead" l
      left join "Client" c on c.id = l."clientId"
      order by l."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Lead"`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// POST /api/leads
leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pick(req.body));
    const [created] = await sql`insert into "Lead" ${sql(data)} returning *`;
    res.status(201).json(created);
  }),
);

// PUT /api/leads/:id
leadsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const [updated] = await sql`
      update "Lead" set ${sql(data)}, "updatedAt" = now()
      where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Lead não encontrado.");
    res.json(updated);
  }),
);

// DELETE /api/leads/:id
leadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "Lead" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Lead não encontrado.");
    res.json({ ok: true });
  }),
);

// POST /api/leads/:id/converter — vira Cliente reaproveitando os dados.
leadsRouter.post(
  "/:id/converter",
  asyncHandler(async (req, res) => {
    const [lead] = await sql`select * from "Lead" where id = ${req.params.id}`;
    if (!lead) throw new HttpError(404, "Lead não encontrado.");
    if (lead.clientId) throw new HttpError(400, "Este lead já foi convertido.");

    const client = prepInsert({
      personType: lead.company ? "PJ" : "PF",
      name: lead.name,
      tradeName: lead.company,
      email: lead.email,
      phone: lead.phone,
      notes: lead.notes,
    });
    const [created] = await sql`insert into "Client" ${sql(client)} returning *`;

    await sql`
      update "Lead"
      set status = 'CONVERTIDO', "clientId" = ${created.id}, "updatedAt" = now()
      where id = ${lead.id}`;

    res.json({ client: created });
  }),
);
