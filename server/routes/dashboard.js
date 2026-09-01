import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler } from "../utils.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(requireRole(...rolesForModule("dashboard")));

const ACTIVE = ["CONFIRMADO", "EM_PLANEJAMENTO", "EM_EXECUCAO"];
const OPEN_STAGES = ["PROSPECCAO", "QUALIFICACAO", "PROPOSTA", "NEGOCIACAO"];

// GET /api/dashboard
dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const [[{ count: activeEvents }], [{ count: clients }], [receivable], upcoming, funnelRows] =
      await Promise.all([
        sql`select count(*)::int from "Event" where status = any(${ACTIVE})`,
        sql`select count(*)::int from "Client"`,
        sql`
          select coalesce(sum("amountCents"),0)::bigint as total
          from "AccountReceivable"
          where status = 'PENDENTE'
            and "dueDate" >= date_trunc('month', now())
            and "dueDate" < date_trunc('month', now()) + interval '1 month'`,
        sql`
          select e.id, e.title, e.status, e."eventDate",
                 c.name as "clientName", t.name as "eventTypeName"
          from "Event" e
          left join "Client" c on c.id = e."clientId"
          left join "EventType" t on t.id = e."eventTypeId"
          where e."eventDate" >= now() and e.status <> 'CANCELADO'
          order by e."eventDate" asc limit 6`,
        sql`
          select stage, count(*)::int as count, coalesce(sum("estimatedCents"),0)::bigint as total
          from "Opportunity" where stage = any(${OPEN_STAGES})
          group by stage`,
      ]);

    const funnelMap = new Map(funnelRows.map((r) => [r.stage, r]));
    const funnel = OPEN_STAGES.map((stage) => ({
      stage,
      count: funnelMap.get(stage)?.count ?? 0,
      totalCents: Number(funnelMap.get(stage)?.total ?? 0),
    }));

    res.json({
      kpis: {
        activeEvents,
        clients,
        receivableThisMonthCents: Number(receivable.total),
      },
      upcoming,
      funnel,
    });
  }),
);
