import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toDate, toDateOrNull } from "../utils.js";

export const operacionalRouter = Router();
operacionalRouter.use(requireAuth);
operacionalRouter.use(requireRole(...rolesForModule("operacional")));

const TASK_STATUS = ["A_FAZER", "EM_ANDAMENTO", "CONCLUIDA", "BLOQUEADA"];
const TASK_PRIORITY = ["BAIXA", "MEDIA", "ALTA", "URGENTE"];

// GET /api/operacional/eventos — eventos p/ o seletor.
operacionalRouter.get(
  "/eventos",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select e.id, e.title, e.status, e."eventDate", c.name as "clientName"
      from "Event" e left join "Client" c on c.id = e."clientId"
      where e.status <> 'CANCELADO'
      order by e."eventDate" asc nulls last, e."createdAt" desc`;
    res.json(rows);
  }),
);

// GET /api/operacional/evento/:eventId — tarefas + checklists + cronograma.
operacionalRouter.get(
  "/evento/:eventId",
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const [tasks, checklists, schedule, users] = await Promise.all([
      sql`
        select t.*, u.name as "assigneeName"
        from "Task" t left join "User" u on u.id = t."assigneeId"
        where t."eventId" = ${eventId}
        order by case t.priority when 'URGENTE' then 0 when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end,
                 t."dueDate" asc nulls last`,
      sql`select * from "Checklist" where "eventId" = ${eventId} order by "id" asc`,
      sql`select * from "ScheduleItem" where "eventId" = ${eventId} order by "startsAt" asc`,
      sql`select id, name from "User" where active = true order by name asc`,
    ]);
    const checklistIds = checklists.map((c) => c.id);
    const items = checklistIds.length
      ? await sql`select * from "ChecklistItem" where "checklistId" in ${sql(checklistIds)} order by "order" asc, "id" asc`
      : [];
    const byChecklist = new Map(checklists.map((c) => [c.id, { ...c, items: [] }]));
    for (const it of items) byChecklist.get(it.checklistId)?.items.push(it);
    res.json({ tasks, checklists: [...byChecklist.values()], schedule, users });
  }),
);

// ---- Tarefas ----
operacionalRouter.post(
  "/tarefas",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!nn(b.eventId)) throw new HttpError(400, "Evento é obrigatório.");
    if (!nn(b.title)) throw new HttpError(400, "Informe o título da tarefa.");
    const data = prepInsert({
      eventId: b.eventId,
      title: b.title.trim(),
      description: nn(b.description),
      assigneeId: nn(b.assigneeId),
      status: TASK_STATUS.includes(b.status) ? b.status : "A_FAZER",
      priority: TASK_PRIORITY.includes(b.priority) ? b.priority : "MEDIA",
      dueDate: toDateOrNull(b.dueDate, "Prazo"),
    });
    try {
      const [created] = await sql`insert into "Task" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Evento ou responsável selecionado não existe mais.");
      throw e;
    }
  }),
);

operacionalRouter.patch(
  "/tarefas/:id",
  asyncHandler(async (req, res) => {
    const patch = {};
    if (TASK_STATUS.includes(req.body?.status)) patch.status = req.body.status;
    if (TASK_PRIORITY.includes(req.body?.priority)) patch.priority = req.body.priority;
    if ("assigneeId" in (req.body || {})) patch.assigneeId = nn(req.body.assigneeId);
    if (!Object.keys(patch).length) throw new HttpError(400, "Nada para atualizar.");
    try {
      const [updated] = await sql`update "Task" set ${sql(patch)}, "updatedAt" = now() where id = ${req.params.id} returning *`;
      if (!updated) throw new HttpError(404, "Tarefa não encontrada.");
      res.json(updated);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Responsável selecionado não existe mais.");
      throw e;
    }
  }),
);

operacionalRouter.delete(
  "/tarefas/:id",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "Task" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Tarefa não encontrada.");
    res.json({ ok: true });
  }),
);

// ---- Checklists ----
operacionalRouter.post(
  "/checklists",
  asyncHandler(async (req, res) => {
    if (!nn(req.body?.eventId) || !nn(req.body?.title)) throw new HttpError(400, "Evento e título são obrigatórios.");
    const data = prepInsert({ eventId: req.body.eventId, title: req.body.title.trim() }, { updatedAt: false });
    delete data.createdAt; // Checklist não tem createdAt
    try {
      const [created] = await sql`insert into "Checklist" ${sql(data)} returning *`;
      res.status(201).json({ ...created, items: [] });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Evento selecionado não existe mais.");
      throw e;
    }
  }),
);

operacionalRouter.delete(
  "/checklists/:id",
  asyncHandler(async (req, res) => {
    await sql`delete from "ChecklistItem" where "checklistId" = ${req.params.id}`;
    const [deleted] = await sql`delete from "Checklist" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Checklist não encontrado.");
    res.json({ ok: true });
  }),
);

operacionalRouter.post(
  "/checklists/:id/itens",
  asyncHandler(async (req, res) => {
    if (!nn(req.body?.label)) throw new HttpError(400, "Informe o item.");
    const data = prepInsert({ checklistId: req.params.id, label: req.body.label.trim(), done: false }, { updatedAt: false });
    delete data.createdAt; // ChecklistItem não tem createdAt
    try {
      const [created] = await sql`insert into "ChecklistItem" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Checklist selecionado não existe mais.");
      throw e;
    }
  }),
);

operacionalRouter.patch(
  "/checklists/itens/:id",
  asyncHandler(async (req, res) => {
    const done = req.body?.done === true || req.body?.done === "true";
    const [updated] = await sql`
      update "ChecklistItem" set done = ${done}, "doneAt" = ${done ? sql`now()` : null}
      where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Item não encontrado.");
    res.json(updated);
  }),
);

operacionalRouter.delete(
  "/checklists/itens/:id",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "ChecklistItem" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Item de checklist não encontrado.");
    res.json({ ok: true });
  }),
);

// ---- Cronograma ----
operacionalRouter.post(
  "/cronograma",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!nn(b.eventId) || !nn(b.title) || !nn(b.startsAt)) throw new HttpError(400, "Evento, título e início são obrigatórios.");
    const data = prepInsert({
      eventId: b.eventId,
      title: b.title.trim(),
      startsAt: toDate(b.startsAt, "Início"),
      endsAt: toDateOrNull(b.endsAt, "Fim"),
      location: nn(b.location),
      notes: nn(b.notes),
    }, { updatedAt: false });
    delete data.createdAt; // ScheduleItem não tem createdAt
    try {
      const [created] = await sql`insert into "ScheduleItem" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Evento selecionado não existe mais.");
      throw e;
    }
  }),
);

operacionalRouter.delete(
  "/cronograma/:id",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "ScheduleItem" where id = ${req.params.id} returning id`;
    if (!deleted) throw new HttpError(404, "Item de cronograma não encontrado.");
    res.json({ ok: true });
  }),
);
