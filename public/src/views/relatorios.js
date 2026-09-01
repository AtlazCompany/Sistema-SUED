// View de Relatórios: visão consolidada do ERP (agregações do backend).
import { api } from "../api.js";
import { el, formatBRL } from "../utils.js";

const EVENT_STATUS_LABEL = {
  RASCUNHO: "Rascunho", ORCAMENTO: "Orçamento", PROPOSTA: "Proposta",
  CONFIRMADO: "Confirmado", EM_PLANEJAMENTO: "Em planejamento", EM_EXECUCAO: "Em execução",
  REALIZADO: "Realizado", POS_EVENTO: "Pós-evento", CANCELADO: "Cancelado",
};
const STAGE_LABEL = {
  PROSPECCAO: "Prospecção", QUALIFICACAO: "Qualificação", PROPOSTA: "Proposta",
  NEGOCIACAO: "Negociação", GANHO: "Ganho", PERDIDO: "Perdido",
};

function card(title, node) {
  return el("div", { class: "card card--pad" }, [
    el("h2", { style: "font-size:14px;font-weight:600;margin-bottom:14px" }, title),
    node,
  ]);
}

function barList(rows, labelFn, valueFn, fmtFn) {
  const max = Math.max(1, ...rows.map((r) => Number(valueFn(r))));
  return el("div", { style: "display:flex;flex-direction:column;gap:10px" },
    rows.length ? rows.map((r) =>
      el("div", {}, [
        el("div", { class: "flex items-center justify-between", style: "font-size:12px;margin-bottom:4px" }, [
          el("span", { style: "font-weight:500" }, labelFn(r)),
          el("span", { class: "text-muted" }, fmtFn(r)),
        ]),
        el("div", { style: "height:8px;background:var(--sued-marble-2);border-radius:999px;overflow:hidden" }, [
          el("div", { style: `height:100%;width:${(Number(valueFn(r)) / max) * 100}%;background:var(--sued-gold);border-radius:999px` }),
        ]),
      ]),
    ) : [el("p", { class: "text-muted", style: "font-size:13px" }, "Sem dados ainda.")],
  );
}

function simpleTable(headers, rows) {
  return el("table", { class: "budget-items", style: "width:100%" }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { style: h.align ? `text-align:${h.align}` : "" }, h.label)))]),
    el("tbody", {}, rows.length
      ? rows.map((cells) => el("tr", {}, cells.map((c) => el("td", { style: c.align ? `text-align:${c.align}` : "" }, c.node ?? c))))
      : [el("tr", {}, [el("td", { colspan: String(headers.length), class: "text-muted", style: "padding:16px;text-align:center" }, "Sem dados.")])]),
  ]);
}

export async function renderRelatorios() {
  const d = await api.get("/relatorios");
  const lucroTotal = Number(d.totais.receitaTotal) - Number(d.totais.custoTotal);
  const margemTotal = Number(d.totais.receitaTotal) > 0
    ? ((lucroTotal / Number(d.totais.receitaTotal)) * 100).toFixed(1) + "%" : "—";

  const kpi = (label, value, color) => el("div", { class: "card kpi" }, [
    el("div", { class: "kpi__label" }, label),
    el("div", { class: "kpi__value", style: color ? `color:${color}` : "" }, value),
  ]);

  return el("div", {}, [
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, "Relatórios"), el("p", {}, "Visão consolidada da operação de eventos.")]),
    ]),

    el("div", { class: "grid grid-kpis", style: "margin-bottom:16px" }, [
      kpi("Eventos", String(d.totais.totalEventos)),
      kpi("Clientes", String(d.totais.totalClientes)),
      kpi("Receita realizada", formatBRL(d.totais.receitaTotal), "var(--sued-success)"),
      kpi("Lucro / Margem", `${formatBRL(lucroTotal)} · ${margemTotal}`, lucroTotal < 0 ? "var(--sued-danger)" : ""),
    ]),

    el("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:16px;align-items:start" }, [
      card("Eventos por status", barList(
        d.eventosPorStatus, (r) => EVENT_STATUS_LABEL[r.status] || r.status, (r) => r.n, (r) => `${r.n}`,
      )),
      card("Funil comercial", barList(
        d.funil, (r) => STAGE_LABEL[r.stage] || r.stage, (r) => r.n, (r) => `${r.n} · ${formatBRL(r.total)}`,
      )),
    ]),

    el("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin-top:16px" }, [
      card("Lucro por evento (realizado)", simpleTable(
        [{ label: "Evento" }, { label: "Receita", align: "right" }, { label: "Custo", align: "right" }, { label: "Lucro", align: "right" }],
        d.lucroPorEvento.map((e) => [
          e.title,
          { node: formatBRL(e.receita), align: "right" },
          { node: formatBRL(e.custo), align: "right" },
          { node: el("span", { style: `font-weight:600;color:${Number(e.lucro) < 0 ? "var(--sued-danger)" : "var(--sued-success)"}` }, formatBRL(e.lucro)), align: "right" },
        ]),
      )),
      card("Ranking de clientes", simpleTable(
        [{ label: "Cliente" }, { label: "Eventos", align: "center" }, { label: "Receita", align: "right" }],
        d.rankingClientes.map((c) => [
          c.name,
          { node: String(c.eventos), align: "center" },
          { node: formatBRL(c.receita), align: "right" },
        ]),
      )),
    ]),

    el("div", { style: "margin-top:16px" }, [
      card("Fluxo de caixa por mês", simpleTable(
        [{ label: "Mês" }, { label: "Entradas", align: "right" }, { label: "Saídas", align: "right" }, { label: "Saldo", align: "right" }],
        d.financeiroMes.map((m) => {
          const saldo = Number(m.entradas) - Number(m.saidas);
          return [
            m.mes,
            { node: el("span", { style: "color:var(--sued-success)" }, formatBRL(m.entradas)), align: "right" },
            { node: el("span", { style: "color:var(--sued-danger)" }, formatBRL(m.saidas)), align: "right" },
            { node: el("span", { style: `font-weight:600;color:${saldo < 0 ? "var(--sued-danger)" : ""}` }, formatBRL(saldo)), align: "right" },
          ];
        }),
      )),
    ]),
  ]);
}
