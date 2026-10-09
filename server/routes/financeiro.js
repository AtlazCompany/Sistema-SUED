import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents, toDateOrNull, withId, parsePagination, addMonthsClamped } from "../utils.js";
import { logAudit } from "../audit.js";

export const financeiroRouter = Router();
financeiroRouter.use(requireAuth);
financeiroRouter.use(requireRole(...rolesForModule("financeiro")));

// Cada tipo de conta tem o mesmo ciclo (PENDENTE → liquidada | CANCELADO;
// liquidada → estorno volta a PENDENTE); só mudam tabela, nomes e o campo do
// evento que acumula o realizado. As rotas de escrita abaixo são genéricas
// sobre esta configuração.
const KINDS = {
  receber: {
    table: "AccountReceivable",
    label: "Conta a receber",
    doneStatus: "RECEBIDO",
    doneVerb: "recebida",
    doneDateCol: "receivedDate",
    doneDateLabel: "Data do recebimento",
    txKind: "ENTRADA",
    txLink: "receivableId",
    settlePath: "receber",
    bumpEvent: (tx, eventId, delta) => tx`
      update "Event" set "actualRevenueCents" = greatest("actualRevenueCents" + ${delta}, 0), "updatedAt" = now()
      where id = ${eventId}`,
  },
  pagar: {
    table: "AccountPayable",
    label: "Conta a pagar",
    doneStatus: "PAGO",
    doneVerb: "paga",
    doneDateCol: "paidDate",
    doneDateLabel: "Data do pagamento",
    txKind: "SAIDA",
    txLink: "payableId",
    settlePath: "pagar",
    hasSupplier: true,
    bumpEvent: (tx, eventId, delta) => tx`
      update "Event" set "actualCostCents" = greatest("actualCostCents" + ${delta}, 0), "updatedAt" = now()
      where id = ${eventId}`,
  },
};

const MAX_INSTALLMENTS = 36;
const DAY_MS = 24 * 60 * 60 * 1000;

// Data de liquidação informada pelo usuário ("só-dia" AAAA-MM-DD) ou agora.
// Não aceita o futuro (uma folga de 1 dia cobre o fuso do navegador).
function parseSettleDate(value, label) {
  const d = toDateOrNull(value, label);
  if (!d) return new Date();
  if (d.getTime() > Date.now() + DAY_MS) throw new HttpError(400, `${label} não pode estar no futuro.`);
  return d;
}

// Desfaz o efeito de uma liquidação: remove o lançamento do caixa e tira o
// valor do realizado do evento. Usado pelo estorno e pela exclusão de conta
// já liquidada.
async function reverseSettlement(tx, cfg, row) {
  await tx`delete from "Transaction" where ${tx(cfg.txLink)} = ${row.id}`;
  if (row.eventId) await cfg.bumpEvent(tx, row.eventId, -row.amountCents);
}

// Carrega a conta travando a linha (evita duas liquidações simultâneas).
async function loadForUpdate(tx, cfg, id) {
  const [row] = await tx`select * from ${tx(cfg.table)} where id = ${id} for update`;
  if (!row) throw new HttpError(404, `${cfg.label} não encontrada.`);
  return row;
}

function pickConta(b, cfg) {
  if (!nn(b.description)) throw new HttpError(400, "Informe a descrição.");
  const amountCents = toCents(b.amount);
  // Achado B4 (Fase 5): valor não pode ser negativo nem zero.
  if (amountCents <= 0) throw new HttpError(400, "O valor deve ser maior que zero.");
  return {
    description: String(b.description).trim(),
    eventId: nn(b.eventId),
    ...(cfg.hasSupplier ? { supplierId: nn(b.supplierId) } : {}),
    amountCents,
    dueDate: toDateOrNull(b.dueDate, "Data de vencimento"),
  };
}

const fkMessage = (cfg) =>
  cfg.hasSupplier ? "Evento ou fornecedor selecionado não existe mais." : "Evento selecionado não existe mais.";

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

// "Hoje" para vencimento = data civil em Teresina (UTC−3, sem horário de
// verão). Comparar a coluna "date" com now() fazia a conta que vence HOJE
// já contar como atrasada desde a meia-noite UTC.
const TODAY_BR = sql`(now() at time zone 'America/Fortaleza')::date`;

// Dia civil (UTC) de um lançamento, e início do mês corrente em Teresina.
const TX_DAY = sql`(date at time zone 'UTC')::date`;
const MONTH_START = sql`date_trunc('month', ${TODAY_BR})::date`;
const HORIZONS = [30, 60, 90];

// Pendentes por vencimento: o que já venceu somado ao que vence em até N
// dias (conta vencida e não paga ainda precisa ser paga/recebida). Sem
// vencimento fica de fora da previsão e vai à parte.
function pendingByHorizon(table) {
  return sql`
    select
      coalesce(sum("amountCents") filter (where "dueDate" <= ${TODAY_BR} + 30), 0)::bigint as d30,
      coalesce(sum("amountCents") filter (where "dueDate" <= ${TODAY_BR} + 60), 0)::bigint as d60,
      coalesce(sum("amountCents") filter (where "dueDate" <= ${TODAY_BR} + 90), 0)::bigint as d90,
      coalesce(sum("amountCents") filter (where "dueDate" is null), 0)::bigint as "semVencimento"
    from ${sql(table)} where status = 'PENDENTE'`;
}

// GET /api/financeiro/resumo — KPIs, mês corrente, previsão e próximos vencimentos.
financeiroRouter.get(
  "/resumo",
  asyncHandler(async (req, res) => {
    const [[receber], [pagar], [entradas], [saidas], [atrasR], [atrasP], [mes], [prevR], [prevP], proximos] = await Promise.all([
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "AccountReceivable" where status = 'PENDENTE'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "AccountPayable" where status = 'PENDENTE'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "Transaction" where kind = 'ENTRADA'`,
      sql`select coalesce(sum("amountCents"),0)::bigint as v from "Transaction" where kind = 'SAIDA'`,
      sql`select count(*)::int as n, coalesce(sum("amountCents"),0)::bigint as v from "AccountReceivable" where status = 'PENDENTE' and "dueDate" < ${TODAY_BR}`,
      sql`select count(*)::int as n, coalesce(sum("amountCents"),0)::bigint as v from "AccountPayable" where status = 'PENDENTE' and "dueDate" < ${TODAY_BR}`,
      // Mês corrente (dia civil do lançamento dentro do mês de hoje).
      sql`
        select
          coalesce(sum("amountCents") filter (where kind = 'ENTRADA'), 0)::bigint as entradas,
          coalesce(sum("amountCents") filter (where kind = 'SAIDA'), 0)::bigint as saidas
        from "Transaction"
        where ${TX_DAY} >= ${MONTH_START} and ${TX_DAY} < ${MONTH_START} + interval '1 month'`,
      pendingByHorizon("AccountReceivable"),
      pendingByHorizon("AccountPayable"),
      // Próximos vencimentos (hoje em diante), das duas listas juntas.
      sql`
        (select 'receber' as kind, id, description, "dueDate", "amountCents" from "AccountReceivable"
          where status = 'PENDENTE' and "dueDate" >= ${TODAY_BR} order by "dueDate" asc limit 8)
        union all
        (select 'pagar' as kind, id, description, "dueDate", "amountCents" from "AccountPayable"
          where status = 'PENDENTE' and "dueDate" >= ${TODAY_BR} order by "dueDate" asc limit 8)
        order by "dueDate" asc limit 8`,
    ]);
    const saldoCents = Number(entradas.v) - Number(saidas.v);
    res.json({
      aReceberCents: Number(receber.v),
      aPagarCents: Number(pagar.v),
      entradasCents: Number(entradas.v),
      saidasCents: Number(saidas.v),
      saldoCents,
      atrasadas: atrasR.n,
      atrasadasReceberCents: Number(atrasR.v),
      atrasadasPagar: atrasP.n,
      atrasadasPagarCents: Number(atrasP.v),
      mes: {
        entradasCents: Number(mes.entradas),
        saidasCents: Number(mes.saidas),
        resultadoCents: Number(mes.entradas) - Number(mes.saidas),
      },
      // Saldo projetado = caixa de hoje + a receber − a pagar até o horizonte.
      previsao: HORIZONS.map((dias) => ({
        dias,
        receberCents: Number(prevR[`d${dias}`]),
        pagarCents: Number(prevP[`d${dias}`]),
        saldoProjetadoCents: saldoCents + Number(prevR[`d${dias}`]) - Number(prevP[`d${dias}`]),
      })),
      semVencimento: { receberCents: Number(prevR.semVencimento), pagarCents: Number(prevP.semVencimento) },
      proximos: proximos.map((p) => ({ kind: p.kind, id: p.id, description: p.description, dueDate: p.dueDate, amountCents: p.amountCents })),
    });
  }),
);

// ---- Listagens ----
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

// ---- Escrita (igual para contas a receber e a pagar) ----
for (const [path, cfg] of Object.entries(KINDS)) {
  // Criar — com "installments" (1 a 36) gera parcelas mensais: "amount" é o
  // valor de CADA parcela e o vencimento da primeira vem em "dueDate".
  financeiroRouter.post(
    `/${path}`,
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      const base = pickConta(b, cfg);
      const n = nn(b.installments) === null ? 1 : Math.floor(Number(b.installments));
      if (!(n >= 1 && n <= MAX_INSTALLMENTS))
        throw new HttpError(400, `Parcelas: informe de 1 a ${MAX_INSTALLMENTS}.`);
      if (n > 1 && !base.dueDate)
        throw new HttpError(400, "Para parcelar, informe o vencimento da primeira parcela.");

      try {
        const created = await sql.begin(async (tx) => {
          const out = [];
          for (let i = 0; i < n; i += 1) {
            const data = prepInsert({
              ...base,
              description: n > 1 ? `${base.description} (${i + 1}/${n})` : base.description,
              dueDate: n > 1 ? addMonthsClamped(base.dueDate, i) : base.dueDate,
              status: "PENDENTE",
            });
            const [c] = await tx`insert into ${tx(cfg.table)} ${tx(data)} returning *`;
            await logAudit(tx, { table: cfg.table, recordId: c.id, action: "CREATE", user: req.user, before: null, after: c });
            out.push(c);
          }
          return out;
        });
        res.status(201).json(n > 1 ? { parcelas: created } : created[0]);
      } catch (e) {
        if (e.code === "23503") throw new HttpError(400, fkMessage(cfg));
        throw e;
      }
    }),
  );

  // Editar. Conta já liquidada só aceita nova descrição (valor/vencimento/
  // evento mexem no caixa já lançado — estorne antes); cancelada é definitiva.
  financeiroRouter.put(
    `/${path}/:id`,
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      try {
        const updated = await sql.begin(async (tx) => {
          const cur = await loadForUpdate(tx, cfg, req.params.id);
          if (cur.status === "CANCELADO") throw new HttpError(400, `${cfg.label} cancelada não pode ser editada.`);
          const fields = cur.status === cfg.doneStatus
            ? { description: pickConta({ ...b, amount: cur.amountCents / 100 }, cfg).description }
            : pickConta(b, cfg);
          const [row] = await tx`update ${tx(cfg.table)} set ${tx(fields)}, "updatedAt" = now() where id = ${cur.id} returning *`;
          if (fields.description !== cur.description)
            await tx`update "Transaction" set description = ${fields.description} where ${tx(cfg.txLink)} = ${cur.id}`;
          await logAudit(tx, { table: cfg.table, recordId: cur.id, action: "UPDATE", user: req.user, before: cur, after: row });
          return row;
        });
        res.json(updated);
      } catch (e) {
        if (e.code === "23503") throw new HttpError(400, fkMessage(cfg));
        throw e;
      }
    }),
  );

  // Liquidar (pagar/receber) → lançamento no caixa + realizado do evento.
  // "date" (opcional, AAAA-MM-DD) é o dia em que o dinheiro de fato saiu/entrou.
  financeiroRouter.post(
    `/${path}/:id/${cfg.settlePath}`,
    asyncHandler(async (req, res) => {
      const date = parseSettleDate(req.body?.date, cfg.doneDateLabel);
      await sql.begin(async (tx) => {
        const row = await loadForUpdate(tx, cfg, req.params.id);
        if (row.status === cfg.doneStatus) return;
        if (row.status === "CANCELADO") throw new HttpError(400, `${cfg.label} cancelada não pode ser liquidada.`);
        const [updated] = await tx`
          update ${tx(cfg.table)} set ${tx({ status: cfg.doneStatus, [cfg.doneDateCol]: date })}, "updatedAt" = now()
          where id = ${row.id} returning *`;
        await tx`insert into "Transaction" ${tx(withId({
          kind: cfg.txKind, description: row.description, amountCents: row.amountCents,
          date, eventId: row.eventId, [cfg.txLink]: row.id,
        }))}`;
        if (row.eventId) await cfg.bumpEvent(tx, row.eventId, row.amountCents);
        await logAudit(tx, { table: cfg.table, recordId: row.id, action: "UPDATE", user: req.user, before: row, after: updated });
      });
      res.json({ ok: true });
    }),
  );

  // Estornar: desfaz a liquidação (volta a PENDENTE, sai do caixa e do realizado).
  financeiroRouter.post(
    `/${path}/:id/estornar`,
    asyncHandler(async (req, res) => {
      await sql.begin(async (tx) => {
        const row = await loadForUpdate(tx, cfg, req.params.id);
        if (row.status !== cfg.doneStatus)
          throw new HttpError(400, `Só é possível estornar uma conta ${cfg.doneVerb}.`);
        await reverseSettlement(tx, cfg, row);
        const [updated] = await tx`
          update ${tx(cfg.table)} set ${tx({ status: "PENDENTE", [cfg.doneDateCol]: null })}, "updatedAt" = now()
          where id = ${row.id} returning *`;
        await logAudit(tx, { table: cfg.table, recordId: row.id, action: "UPDATE", user: req.user, before: row, after: updated });
      });
      res.json({ ok: true });
    }),
  );

  // Cancelar: só conta pendente; definitivo.
  financeiroRouter.post(
    `/${path}/:id/cancelar`,
    asyncHandler(async (req, res) => {
      await sql.begin(async (tx) => {
        const row = await loadForUpdate(tx, cfg, req.params.id);
        if (row.status !== "PENDENTE")
          throw new HttpError(400, "Só é possível cancelar uma conta pendente (estorne antes, se já foi liquidada).");
        const [updated] = await tx`
          update ${tx(cfg.table)} set status = 'CANCELADO', "updatedAt" = now() where id = ${row.id} returning *`;
        await logAudit(tx, { table: cfg.table, recordId: row.id, action: "UPDATE", user: req.user, before: row, after: updated });
      });
      res.json({ ok: true });
    }),
  );

  // Excluir. Conta já liquidada é estornada junto (caixa e evento voltam).
  financeiroRouter.delete(
    `/${path}/:id`,
    asyncHandler(async (req, res) => {
      await sql.begin(async (tx) => {
        const row = await loadForUpdate(tx, cfg, req.params.id);
        if (row.status === cfg.doneStatus) await reverseSettlement(tx, cfg, row);
        await tx`delete from ${tx(cfg.table)} where id = ${row.id}`;
        await logAudit(tx, { table: cfg.table, recordId: row.id, action: "DELETE", user: req.user, before: row, after: null });
      });
      res.json({ ok: true });
    }),
  );
}

// ---- Extrato do fluxo de caixa (por período, com saldo acumulado) ----
// GET /api/financeiro/extrato?from=AAAA-MM-DD&to=AAAA-MM-DD (ambos opcionais).
// O saldo inicial é tudo que entrou/saiu ANTES de "from"; cada linha traz o
// saldo acumulado até ela. Datas de lançamento são "só-dia" (meia-noite UTC).
const EXTRATO_LIMIT = 5000;
const SIGNED = sql`case when kind = 'ENTRADA' then "amountCents" else -"amountCents" end`;

financeiroRouter.get(
  "/extrato",
  asyncHandler(async (req, res) => {
    const from = toDateOrNull(req.query.from, "Data inicial");
    const to = toDateOrNull(req.query.to, "Data final");
    if (from && to && from > to) throw new HttpError(400, "A data inicial não pode ser depois da final.");
    const toExclusive = to ? new Date(to.getTime() + DAY_MS) : null;

    const [{ opening }] = from
      ? await sql`select coalesce(sum(${SIGNED}), 0)::bigint as opening from "Transaction" where date < ${from}`
      : [{ opening: 0 }];
    const rows = await sql`
      select t.*, e.title as "eventTitle"
      from "Transaction" t left join "Event" e on e.id = t."eventId"
      where true ${from ? sql`and t.date >= ${from}` : sql``} ${toExclusive ? sql`and t.date < ${toExclusive}` : sql``}
      order by t.date asc, t.id asc limit ${EXTRATO_LIMIT}`;

    let balance = Number(opening);
    let entradas = 0;
    let saidas = 0;
    const out = rows.map((r) => {
      if (r.kind === "ENTRADA") { entradas += r.amountCents; balance += r.amountCents; }
      else { saidas += r.amountCents; balance -= r.amountCents; }
      // "avulso" = lançamento feito direto no caixa (não veio de uma conta).
      return { ...r, avulso: !r.receivableId && !r.payableId, balanceCents: balance };
    });
    res.json({
      openingCents: Number(opening),
      entradasCents: entradas,
      saidasCents: saidas,
      closingCents: balance,
      truncated: rows.length >= EXTRATO_LIMIT,
      rows: out,
    });
  }),
);

// ---- Lançamentos avulsos (entradas/saídas direto no caixa) ----
// Para o que não passa por conta a pagar/receber (ex.: saldo inicial, tarifa
// bancária). Se informar evento, soma no realizado dele como as contas fazem.
financeiroRouter.post(
  "/lancamentos",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (b.kind !== "ENTRADA" && b.kind !== "SAIDA") throw new HttpError(400, "Tipo inválido: use ENTRADA ou SAIDA.");
    if (!nn(b.description)) throw new HttpError(400, "Informe a descrição.");
    const amountCents = toCents(b.amount);
    if (amountCents <= 0) throw new HttpError(400, "O valor deve ser maior que zero.");
    const date = parseSettleDate(b.date, "Data");
    const eventId = nn(b.eventId);
    const cfg = b.kind === "ENTRADA" ? KINDS.receber : KINDS.pagar;
    try {
      const created = await sql.begin(async (tx) => {
        const [row] = await tx`insert into "Transaction" ${tx(withId({
          kind: b.kind, description: String(b.description).trim(), amountCents, date, eventId,
        }))} returning *`;
        if (eventId) await cfg.bumpEvent(tx, eventId, amountCents);
        await logAudit(tx, { table: "Transaction", recordId: row.id, action: "CREATE", user: req.user, before: null, after: row });
        return row;
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503") throw new HttpError(400, "Evento selecionado não existe mais.");
      throw e;
    }
  }),
);

financeiroRouter.delete(
  "/lancamentos/:id",
  asyncHandler(async (req, res) => {
    await sql.begin(async (tx) => {
      const [row] = await tx`select * from "Transaction" where id = ${req.params.id} for update`;
      if (!row) throw new HttpError(404, "Lançamento não encontrado.");
      if (row.receivableId || row.payableId)
        throw new HttpError(400, "Este lançamento veio de uma conta a pagar/receber: estorne a conta para removê-lo.");
      if (row.eventId) await (row.kind === "ENTRADA" ? KINDS.receber : KINDS.pagar).bumpEvent(tx, row.eventId, -row.amountCents);
      await tx`delete from "Transaction" where id = ${row.id}`;
      await logAudit(tx, { table: "Transaction", recordId: row.id, action: "DELETE", user: req.user, before: row, after: null });
    });
    res.json({ ok: true });
  }),
);

// ---- Fluxo de caixa (legado: últimas 100 movimentações; a tela usa /extrato) ----
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
