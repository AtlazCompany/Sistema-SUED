import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, toDateOrNull, parsePagination, assertValidTransition } from "../utils.js";

export const eventosRouter = Router();
eventosRouter.use(requireAuth);
eventosRouter.use(requireRole(...rolesForModule("eventos")));

const STATUSES = [
  "RASCUNHO", "ORCAMENTO", "PROPOSTA", "CONFIRMADO",
  "EM_PLANEJAMENTO", "EM_EXECUCAO", "REALIZADO", "POS_EVENTO", "CANCELADO",
];

// Achado B2 (Fase 5): sequência normal de avanço do evento — só pode
// seguir em frente (pular etapas é permitido, ex.: RASCUNHO direto pra
// CONFIRMADO), nunca voltar. CANCELADO é a saída de emergência,
// disponível a qualquer momento até REALIZADO (inclusive). POS_EVENTO e
// CANCELADO são definitivos — nenhuma mudança de status depois deles.
const STATUS_ORDER = [
  "RASCUNHO", "ORCAMENTO", "PROPOSTA", "CONFIRMADO",
  "EM_PLANEJAMENTO", "EM_EXECUCAO", "REALIZADO", "POS_EVENTO",
];
const STATUS_TERMINAL = ["POS_EVENTO", "CANCELADO"];

// Campos financeiros do evento — só ADMIN/SOCIO/COMERCIAL/FINANCEIRO podem
// alterá-los; OPERACIONAL mantém acesso ao módulo, mas não a estes 4 campos.
const FINANCIAL_FIELDS = [
  "plannedRevenueCents", "actualRevenueCents", "plannedCostCents", "actualCostCents",
];

// Nomes desses mesmos 4 campos como chegam no body (antes do toCents()) —
// usado só na criação, onde a checagem precisa do valor bruto: toCents()
// devolve 0 tanto para "ausente" quanto para "0" explícito, então não dá
// para diferenciar os dois depois da conversão.
const FINANCIAL_BODY_FIELDS = ["plannedRevenue", "actualRevenue", "plannedCost", "actualCost"];

// true se o campo foi efetivamente enviado (0 conta como enviado; ausente,
// undefined, null e "" contam como não enviado).
function wasProvided(value) {
  return value !== undefined && value !== null && value !== "";
}

function pick(body) {
  const data = {
    title: nn(body?.title),
    status: STATUSES.includes(body?.status) ? body.status : "RASCUNHO",
    clientId: nn(body?.clientId),
    eventTypeId: nn(body?.eventTypeId),
    venueId: nn(body?.venueId),
    opportunityId: nn(body?.opportunityId),
    commercialId: nn(body?.commercialId),
    operationalId: nn(body?.operationalId),
    eventDate: toDateOrNull(body?.eventDate, "Data do evento"),
    startTime: nn(body?.startTime),
    endTime: nn(body?.endTime),
    guestCount: nn(body?.guestCount) ? Number(body.guestCount) : null,
    plannedRevenueCents: toCents(body?.plannedRevenue),
    actualRevenueCents: toCents(body?.actualRevenue),
    plannedCostCents: toCents(body?.plannedCost),
    actualCostCents: toCents(body?.actualCost),
    notes: nn(body?.notes),
  };
  if (!data.title) throw new HttpError(400, "Informe o título do evento.");
  return data;
}

// GET /api/eventos?status=
eventosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const whereClause = status ? sql`where e.status = ${status}` : sql``;
    const { paginated, pageSize, offset } = parsePagination(req.query);
    const limitClause = paginated ? sql`limit ${pageSize} offset ${offset}` : sql``;
    const rows = await sql`
      select e.*, c.name as "clientName", t.name as "eventTypeName", v.name as "venueName"
      from "Event" e
      left join "Client" c on c.id = e."clientId"
      left join "EventType" t on t.id = e."eventTypeId"
      left join "Venue" v on v.id = e."venueId"
      ${whereClause}
      order by e."eventDate" asc nulls last, e."createdAt" desc ${limitClause}`;
    if (paginated) {
      const [{ total }] = await sql`select count(*)::int as total from "Event" e ${whereClause}`;
      res.set("X-Total-Count", String(total));
    }
    res.json(rows);
  }),
);

// GET /api/eventos/opcoes — dados para o formulário (reaproveitamento).
eventosRouter.get(
  "/opcoes",
  asyncHandler(async (req, res) => {
    const [clients, types, venues, users, opportunities] = await Promise.all([
      sql`select id, name from "Client" order by name asc`,
      sql`select id, name from "EventType" order by name asc`,
      sql`select id, name from "Venue" order by name asc`,
      sql`select id, name from "User" where active = true order by name asc`,
      // oportunidades ainda sem evento vinculado
      sql`
        select o.id, o.title, c.name as "clientName", o."clientId"
        from "Opportunity" o
        join "Client" c on c.id = o."clientId"
        where not exists (select 1 from "Event" e where e."opportunityId" = o.id)
        order by o."updatedAt" desc`,
    ]);
    res.json({ clients, types, venues, users, opportunities });
  }),
);

// GET /api/eventos/:id
eventosRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [ev] = await sql`
      select e.*,
        c.name as "clientName",
        t.name as "eventTypeName",
        v.name as "venueName",
        uc.name as "commercialName",
        uo.name as "operationalName",
        op.title as "opportunityTitle"
      from "Event" e
      left join "Client" c on c.id = e."clientId"
      left join "EventType" t on t.id = e."eventTypeId"
      left join "Venue" v on v.id = e."venueId"
      left join "User" uc on uc.id = e."commercialId"
      left join "User" uo on uo.id = e."operationalId"
      left join "Opportunity" op on op.id = e."opportunityId"
      where e.id = ${req.params.id}`;
    if (!ev) throw new HttpError(404, "Evento não encontrado.");
    res.json(ev);
  }),
);

// POST /api/eventos
eventosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    // OPERACIONAL pode criar evento, mas não pode definir valores financeiros
    // iniciais — checagem no body bruto (ver FINANCIAL_BODY_FIELDS acima).
    if (req.user.role === "OPERACIONAL") {
      const providedFinancial = FINANCIAL_BODY_FIELDS.some((f) => wasProvided(req.body?.[f]));
      if (providedFinancial)
        throw new HttpError(403, "Sem permissão para definir valores financeiros do evento.");
    }

    const data = prepInsert(pick(req.body));
    // code é unique — usa o próprio id como código amigável inicial
    data.code = data.id;
    try {
      const [created] = await sql`insert into "Event" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23505")
        throw new HttpError(400, "Essa oportunidade já está vinculada a outro evento.");
      if (e.code === "23503")
        throw new HttpError(400, "Cliente, tipo de evento, local, oportunidade, comercial ou operacional selecionado não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/eventos/:id
eventosRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);

    // Buscado incondicionalmente — serve tanto para a checagem de
    // permissão financeira (OPERACIONAL) quanto para a validação de
    // transição de status (achado B2), que precisa do status ATUAL.
    const [current] = await sql`
      select status, "plannedRevenueCents", "actualRevenueCents", "plannedCostCents", "actualCostCents"
      from "Event" where id = ${req.params.id}`;
    if (!current) throw new HttpError(404, "Evento não encontrado.");

    // Sub-permissão: OPERACIONAL não pode alterar valores financeiros do
    // evento. Compara com o valor atual (não com a mera presença da chave no
    // body) porque o formulário sempre reenvia os 4 campos pré-preenchidos
    // para qualquer papel — bloquear por presença quebraria a edição normal
    // de evento para OPERACIONAL mesmo sem tocar em nenhum valor financeiro.
    if (req.user.role === "OPERACIONAL") {
      const changedFinancials = FINANCIAL_FIELDS.some(
        (f) => Number(data[f]) !== Number(current[f]),
      );
      if (changedFinancials)
        throw new HttpError(403, "Sem permissão para alterar valores financeiros do evento.");
    }

    assertValidTransition(current.status, data.status, { order: STATUS_ORDER, terminal: STATUS_TERMINAL });

    try {
      const [updated] = await sql`
        update "Event" set ${sql(data)}, "updatedAt" = now()
        where id = ${req.params.id} returning *`;
      if (!updated) throw new HttpError(404, "Evento não encontrado.");
      res.json(updated);
    } catch (e) {
      if (e.code === "23505")
        throw new HttpError(400, "Essa oportunidade já está vinculada a outro evento.");
      if (e.code === "23503")
        throw new HttpError(400, "Cliente, tipo de evento, local, oportunidade, comercial ou operacional selecionado não existe mais.");
      throw e;
    }
  }),
);

// DELETE /api/eventos/:id
eventosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Event" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Evento não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: este evento está vinculado a outros registros (financeiro, operacional, orçamentos ou contratos). Cancele-o em vez de excluir.",
        );
      throw e;
    }
  }),
);

// ---- Locais (Venues) ----
export const locaisRouter = Router();
locaisRouter.use(requireAuth);
locaisRouter.use(requireRole(...rolesForModule("eventos")));

locaisRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select v.*, (select count(*)::int from "Event" e where e."venueId" = v.id) as events
      from "Venue" v order by v.name asc`;
    res.json(rows);
  }),
);

locaisRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = nn(req.body?.name) ? String(req.body.name).trim() : null;
    if (!name) throw new HttpError(400, "Informe o nome do local.");
    const data = prepInsert({
      name,
      address: nn(req.body?.address),
      city: nn(req.body?.city),
      state: nn(req.body?.state),
      capacity: nn(req.body?.capacity) ? Number(req.body.capacity) : null,
      isOwn: req.body?.isOwn === true || req.body?.isOwn === "true",
      notes: nn(req.body?.notes),
    }, { updatedAt: false });
    const [created] = await sql`insert into "Venue" ${sql(data)} returning *`;
    res.status(201).json(created);
  }),
);

// PUT /api/locais/:id — achado B12 (Fase 5): antes só existia criar/
// listar/excluir, sem forma de corrigir um dado já cadastrado.
locaisRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const name = nn(req.body?.name) ? String(req.body.name).trim() : null;
    if (!name) throw new HttpError(400, "Informe o nome do local.");
    const data = {
      name,
      address: nn(req.body?.address),
      city: nn(req.body?.city),
      state: nn(req.body?.state),
      capacity: nn(req.body?.capacity) ? Number(req.body.capacity) : null,
      isOwn: req.body?.isOwn === true || req.body?.isOwn === "true",
      notes: nn(req.body?.notes),
    };
    // Venue não tem coluna "updatedAt" — não incluir no SET.
    const [updated] = await sql`update "Venue" set ${sql(data)} where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Local não encontrado.");
    res.json(updated);
  }),
);

locaisRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Venue" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Local não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(409, "Não é possível excluir: este local está vinculado a eventos.");
      throw e;
    }
  }),
);

// ---- Tipos de Evento (achado B11, Fase 5) ----
// Mesmo padrão mínimo já usado para Category (server/routes/catalogo.js):
// criar + excluir, sem edição de nome (cadastro de apoio simples). Rota
// própria (não aninhada em /api/eventos) para não colidir com
// eventosRouter.get("/:id")/delete("/:id"), que já capturam qualquer
// segmento único.
export const tiposEventoRouter = Router();
tiposEventoRouter.use(requireAuth);
tiposEventoRouter.use(requireRole(...rolesForModule("eventos")));

tiposEventoRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select t.*, (select count(*)::int from "Event" e where e."eventTypeId" = t.id) as events
      from "EventType" t order by t.name asc`;
    res.json(rows);
  }),
);

tiposEventoRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = nn(req.body?.name) ? String(req.body.name).trim() : null;
    if (!name) throw new HttpError(400, "Informe o nome do tipo de evento.");
    const data = prepInsert({ name }, { updatedAt: false });
    delete data.createdAt; // EventType não tem createdAt/updatedAt
    const [created] = await sql`insert into "EventType" ${sql(data)} returning *`;
    res.status(201).json(created);
  }),
);

tiposEventoRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "EventType" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Tipo de evento não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(409, "Não é possível excluir: existem eventos com este tipo.");
      throw e;
    }
  }),
);
