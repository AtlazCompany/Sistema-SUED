import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler } from "../utils.js";

export const relatoriosRouter = Router();
relatoriosRouter.use(requireAuth);
relatoriosRouter.use(requireRole(...rolesForModule("relatorios")));

// GET /api/relatorios — visão consolidada.
relatoriosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const [
      eventosPorStatus,
      lucroPorEvento,
      funil,
      rankingClientes,
      financeiroMes,
      totais,
    ] = await Promise.all([
      // Eventos agrupados por status
      sql`select status, count(*)::int as n from "Event" group by status order by n desc`,
      // Receita/custo/lucro realizado por evento (top por receita)
      sql`
        select id, title,
          "actualRevenueCents" as receita,
          "actualCostCents" as custo,
          ("actualRevenueCents" - "actualCostCents") as lucro
        from "Event"
        where "actualRevenueCents" > 0 or "actualCostCents" > 0
        order by "actualRevenueCents" desc limit 10`,
      // Funil por estágio
      sql`
        select stage, count(*)::int as n, coalesce(sum("estimatedCents"),0)::bigint as total
        from "Opportunity" group by stage`,
      // Ranking de clientes por nº de eventos e receita
      sql`
        select c.id, c.name,
          count(e.id)::int as eventos,
          coalesce(sum(e."actualRevenueCents"),0)::bigint as receita
        from "Client" c
        left join "Event" e on e."clientId" = c.id
        group by c.id, c.name
        having count(e.id) > 0
        order by receita desc, eventos desc limit 10`,
      // Fluxo de caixa por mês (últimos meses)
      sql`
        select to_char(date_trunc('month', date), 'YYYY-MM') as mes,
          coalesce(sum(case when kind = 'ENTRADA' then "amountCents" else 0 end),0)::bigint as entradas,
          coalesce(sum(case when kind = 'SAIDA' then "amountCents" else 0 end),0)::bigint as saidas
        from "Transaction"
        group by 1 order by 1 desc limit 12`,
      // Totais gerais
      sql`
        select
          (select count(*)::int from "Event") as "totalEventos",
          (select count(*)::int from "Client") as "totalClientes",
          (select coalesce(sum("actualRevenueCents"),0)::bigint from "Event") as "receitaTotal",
          (select coalesce(sum("actualCostCents"),0)::bigint from "Event") as "custoTotal"`,
    ]);

    res.json({
      eventosPorStatus,
      lucroPorEvento,
      funil,
      rankingClientes,
      financeiroMes,
      totais: totais[0],
    });
  }),
);
