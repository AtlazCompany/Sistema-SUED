// View do Dashboard: KPIs + próximos eventos + funil.
import { api } from "../api.js";
import { el, formatBRL, formatDate } from "../utils.js";
import { store } from "../state.js";
import { canAccess } from "../config.js";
import { suedWall } from "../components/sued-wall.js";

const STAGE_LABELS = {
  PROSPECCAO: "Prospecção", QUALIFICACAO: "Qualificação",
  PROPOSTA: "Proposta", NEGOCIACAO: "Negociação",
};
const STATUS_LABELS = {
  CONFIRMADO: "Confirmado", EM_PLANEJAMENTO: "Em planejamento",
  EM_EXECUCAO: "Em execução", RASCUNHO: "Rascunho", REALIZADO: "Realizado",
};

function kpi(label, value, hint) {
  return el("div", { class: "card kpi" }, [
    el("div", { class: "kpi__label" }, label),
    el("div", { class: "kpi__value" }, value),
    hint && el("div", { class: "kpi__hint" }, hint),
  ]);
}

export async function renderDashboard() {
  const user = store.get("user");
  const data = await api.get("/dashboard");
  const firstName = (user?.name || "").split(" ")[0];
  const showFinance = canAccess(user.role, "financeiro") || canAccess(user.role, "relatorios");

  const kpis = el("div", { class: "grid grid-kpis" }, [
    kpi("Eventos ativos", String(data.kpis.activeEvents)),
    kpi("Clientes", String(data.kpis.clients)),
    showFinance && kpi("A receber (mês)", formatBRL(data.kpis.receivableThisMonthCents)),
  ]);

  // Próximos eventos
  const upcoming = data.upcoming.length
    ? el("ul", { class: "list-none" },
        data.upcoming.map((ev) =>
          el("li", { class: "flex items-center justify-between", style: "padding:12px 0;border-bottom:1px solid var(--sued-border)" }, [
            el("div", {}, [
              el("p", { class: "font-medium" }, ev.title),
              el("p", { class: "text-muted text-xs" }, `${ev.clientName || "Sem cliente"}${ev.eventTypeName ? " · " + ev.eventTypeName : ""}`),
            ]),
            el("div", { class: "text-right" }, [
              el("p", { class: "text-soft text-xs" }, formatDate(ev.eventDate)),
              el("span", { class: "badge badge--success" }, STATUS_LABELS[ev.status] || ev.status),
            ]),
          ]),
        ),
      )
    : el("p", { class: "text-muted", style: "padding:24px 0;text-align:center" }, "Nenhum evento agendado.");

  const upcomingCard = el("div", { class: "card card--pad" }, [
    el("h2", { style: "font-size:14px;font-weight:600" }, "Próximos eventos"),
    el("hr", { class: "sued-divider-gold my-4" }),
    upcoming,
  ]);

  // Funil
  const maxCount = Math.max(1, ...data.funnel.map((f) => f.count));
  const funnelCard = el("div", { class: "card card--pad" }, [
    el("h2", { style: "font-size:14px;font-weight:600" }, "Funil comercial"),
    el("hr", { class: "sued-divider-gold my-4" }),
    ...data.funnel.map((f) =>
      el("div", { class: "mb-3" }, [
        el("div", { class: "flex items-center justify-between text-xs mb-1" }, [
          el("span", { class: "font-medium" }, STAGE_LABELS[f.stage] || f.stage),
          el("span", { class: "text-muted" }, `${f.count} · ${formatBRL(f.totalCents)}`),
        ]),
        el("div", { class: "progress" }, [
          el("div", { style: `height:100%;width:${(f.count / maxCount) * 100}%;background:var(--sued-gold);border-radius:999px` }),
        ]),
      ]),
    ),
  ]);

  const grid = el("div", { class: "grid grid-main-side", style: "margin-top:24px" }, [upcomingCard, funnelCard]);

  // Painel institucional "Parede SUED" (mármore + curvas luminosas + veios)
  const hero = suedWall([
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, `Olá, ${firstName}`),
        el("p", {}, "Visão executiva da operação de eventos da SUED."),
      ]),
    ]),
  ]);
  hero.style.marginBottom = "24px";

  return el("div", {}, [hero, kpis, grid]);
}
