// View de Eventos — o HUB do ERP: lista com filtros de status,
// criar/editar (modal) e detalhe com resumo financeiro (previsto x realizado).
import { api } from "../api.js";
import { el, formatBRL, formatDate, centsToReais } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

export const EVENT_STATUS = {
  RASCUNHO: { label: "Rascunho", cls: "badge--muted" },
  ORCAMENTO: { label: "Orçamento", cls: "badge--gold" },
  PROPOSTA: { label: "Proposta", cls: "badge--gold" },
  CONFIRMADO: { label: "Confirmado", cls: "badge--success" },
  EM_PLANEJAMENTO: { label: "Em planejamento", cls: "badge--info" },
  EM_EXECUCAO: { label: "Em execução", cls: "badge--info" },
  REALIZADO: { label: "Realizado", cls: "badge--success" },
  POS_EVENTO: { label: "Pós-evento", cls: "badge--muted" },
  CANCELADO: { label: "Cancelado", cls: "badge--danger" },
};

const FILTERS = [
  { label: "Todos", value: "" },
  { label: "Confirmados", value: "CONFIRMADO" },
  { label: "Em planejamento", value: "EM_PLANEJAMENTO" },
  { label: "Em execução", value: "EM_EXECUCAO" },
  { label: "Realizados", value: "REALIZADO" },
  { label: "Rascunhos", value: "RASCUNHO" },
];

// ---------- Formulário criar/editar ----------
async function eventForm(ev, onSaved) {
  const isEdit = !!ev;
  const e = ev || {};
  const opts = await api.get("/eventos/opcoes");

  const dateVal = e.eventDate ? String(e.eventDate).slice(0, 10) : "";
  const selOpts = (list, current, labelFn) => [
    { value: "", label: "—" },
    ...list.map((x) => ({ value: x.id, label: labelFn ? labelFn(x) : x.name })),
  ];

  const form = el("form", { class: "form-grid" }, [
    field("Título do evento", "title", e.title, { required: true, col2: true, placeholder: "Ex.: Casamento Marina & João" }),
    field("Status", "status", e.status || "RASCUNHO", { type: "select", options:
      Object.entries(EVENT_STATUS).map(([value, s]) => ({ value, label: s.label })) }),
    field("Tipo", "eventTypeId", e.eventTypeId || "", { type: "select", options: selOpts(opts.types) }),
    field("Cliente", "clientId", e.clientId || "", { type: "select", options: selOpts(opts.clients) }),
    field("Oportunidade de origem", "opportunityId", e.opportunityId || "", { type: "select", options: [
      { value: "", label: "—" },
      ...(e.opportunityId ? [{ value: e.opportunityId, label: e.opportunityTitle || "Oportunidade vinculada" }] : []),
      ...opts.opportunities.map((o) => ({ value: o.id, label: `${o.title} · ${o.clientName}` })),
    ] }),
    field("Data", "eventDate", dateVal, { type: "date" }),
    field("Convidados", "guestCount", e.guestCount ?? "", { type: "number" }),
    field("Início", "startTime", e.startTime, { type: "time" }),
    field("Término", "endTime", e.endTime, { type: "time" }),
    field("Local", "venueId", e.venueId || "", { type: "select", options: selOpts(opts.venues), col2: true }),
    field("Resp. comercial", "commercialId", e.commercialId || "", { type: "select", options: selOpts(opts.users) }),
    field("Resp. operacional", "operationalId", e.operationalId || "", { type: "select", options: selOpts(opts.users) }),
    field("Receita prevista (R$)", "plannedRevenue", centsToReais(e.plannedRevenueCents), { placeholder: "0,00" }),
    field("Custo previsto (R$)", "plannedCost", centsToReais(e.plannedCostCents), { placeholder: "0,00" }),
    field("Receita realizada (R$)", "actualRevenue", centsToReais(e.actualRevenueCents), { placeholder: "0,00" }),
    field("Custo realizado (R$)", "actualCost", centsToReais(e.actualCostCents), { placeholder: "0,00" }),
    field("Observações", "notes", e.notes, { type: "textarea", col2: true }),
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar evento");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isEdit ? "Editar evento" : "Novo evento", body: form, footer: [cancel, save], wide: true });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.title?.trim()) return toast("Informe o título do evento.", "error");
    save.disabled = true;
    try {
      if (isEdit) await api.put(`/eventos/${e.id}`, body);
      else await api.post("/eventos", body);
      modal.close();
      toast(isEdit ? "Evento atualizado." : "Evento criado.");
      onSaved();
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
    }
  };
}

// ---------- Detalhe (hub) ----------
async function eventDetail(id, onChanged) {
  const e = await api.get(`/eventos/${id}`);
  const s = EVENT_STATUS[e.status] || { label: e.status, cls: "" };

  const plannedProfit = e.plannedRevenueCents - e.plannedCostCents;
  const actualProfit = e.actualRevenueCents - e.actualCostCents;
  const pct = (profit, revenue) => (revenue > 0 ? ((profit / revenue) * 100).toFixed(1) + "%" : "—");

  const row = (label, value, strong = false, danger = false) =>
    el("div", { class: "opp-summary__row" }, [
      el("span", { class: "text-muted" }, label),
      el("span", { style: `font-weight:${strong ? 600 : 400};${danger ? "color:var(--sued-danger)" : ""}` }, value),
    ]);

  const financeBlock = (title, revenue, cost, profit) =>
    el("div", { style: "flex:1;min-width:200px" }, [
      el("p", { style: "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--sued-gold-dark);margin-bottom:8px" }, title),
      el("div", { class: "opp-summary" }, [
        row("Receita", formatBRL(revenue)),
        row("Custo", formatBRL(cost)),
        row("Lucro", formatBRL(profit), true, profit < 0),
        row("Margem", pct(profit, revenue)),
      ]),
    ]);

  const editBtn = el("button", { class: "btn btn--outline", type: "button", html: `${icon("edit", 15)}<span>Editar</span>` });
  const delBtn = el("button", { class: "btn btn--danger", type: "button", html: `${icon("trash", 15)}<span>Excluir</span>` });
  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");

  const body = el("div", {}, [
    el("div", { class: "flex items-center gap-2", style: "margin-bottom:14px" }, [
      el("span", { class: `badge ${s.cls}` }, s.label),
      e.eventTypeName && el("span", { class: "text-muted", style: "font-size:12px" }, e.eventTypeName),
    ]),
    el("div", { class: "opp-summary" }, [
      row("Cliente", e.clientName || "—"),
      row("Data", `${formatDate(e.eventDate)}${e.startTime ? ` · ${e.startTime}${e.endTime ? "–" + e.endTime : ""}` : ""}`),
      row("Local", e.venueName || "—"),
      row("Convidados", e.guestCount ? String(e.guestCount) : "—"),
      row("Oportunidade", e.opportunityTitle || "—"),
      row("Resp. comercial", e.commercialName || "—"),
      row("Resp. operacional", e.operationalName || "—"),
    ]),
    e.notes && el("p", { class: "text-soft", style: "margin-top:10px;white-space:pre-wrap;font-size:13px" }, e.notes),
    el("hr", { class: "sued-divider-gold", style: "margin:16px 0" }),
    el("h3", { style: "font-size:13px;font-weight:600;margin-bottom:12px" }, "Resumo financeiro"),
    el("div", { class: "flex", style: "gap:24px;flex-wrap:wrap" }, [
      financeBlock("Previsto", e.plannedRevenueCents, e.plannedCostCents, plannedProfit),
      financeBlock("Realizado", e.actualRevenueCents, e.actualCostCents, actualProfit),
    ]),
  ]);

  const modal = openModal({ title: e.title, body, footer: [delBtn, closeBtn, editBtn], wide: true });
  closeBtn.onclick = modal.close;
  editBtn.onclick = () => { modal.close(); eventForm(e, onChanged); };
  delBtn.onclick = async () => {
    if (!confirm(`Excluir o evento "${e.title}"?`)) return;
    try { await api.del(`/eventos/${e.id}`); modal.close(); toast("Evento excluído."); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---------- Tipos de evento (achado B11, Fase 5) ----------
// Mesmo padrão de categoriesModal (public/src/views/catalogo.js): lista +
// remover + adicionar inline, sem tela própria.
async function eventTypesModal(onChanged) {
  const listBox = el("div", {});
  async function reload() {
    const types = await api.get("/tipos-evento");
    listBox.replaceChildren(
      types.length
        ? el("ul", { style: "list-style:none" }, types.map((t) => {
            const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 15) });
            del.onclick = async () => {
              if (!confirm(`Excluir o tipo "${t.name}"?`)) return;
              try { await api.del(`/tipos-evento/${t.id}`); reload(); onChanged(); }
              catch (err) { toast(err.message, "error"); }
            };
            return el("li", { class: "flex items-center justify-between", style: "padding:8px 0;border-bottom:1px solid var(--sued-border);font-size:13px" }, [
              el("span", {}, t.name),
              el("span", { class: "flex items-center gap-3" }, [el("span", { class: "text-muted" }, `${t.events} evento(s)`), del]),
            ]);
          }))
        : el("p", { class: "text-muted", style: "font-size:13px" }, "Nenhum tipo de evento cadastrado."),
    );
  }
  await reload();

  const input = el("input", { class: "input", placeholder: "Novo tipo de evento" });
  const add = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Adicionar");
  add.onclick = async () => {
    if (!input.value.trim()) return;
    try { await api.post("/tipos-evento", { name: input.value }); input.value = ""; reload(); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };

  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");
  const modal = openModal({
    title: "Tipos de evento",
    body: el("div", {}, [listBox, el("div", { class: "flex items-center", style: "gap:8px;margin-top:14px" }, [input, add])]),
    footer: [closeBtn],
  });
  closeBtn.onclick = modal.close;
}

// ---------- Lista ----------
export async function renderEventos() {
  const container = el("div", {});
  let activeFilter = "";

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const eventos = await api.get(`/eventos${activeFilter ? `?status=${activeFilter}` : ""}`);

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo evento</span>` });
    novo.onclick = () => eventForm(null, load);
    const typesBtn = el("button", { class: "btn btn--outline" }, "Tipos de evento");
    typesBtn.onclick = () => eventTypesModal(load);

    const chips = el("div", { class: "filter-chips" },
      FILTERS.map((f) => {
        const chip = el("button", {
          class: `chip ${activeFilter === f.value ? "is-active" : ""}`,
          type: "button",
        }, f.label);
        chip.onclick = () => { activeFilter = f.value; load(); };
        return chip;
      }));

    const table = renderTable({
      columns: [
        { header: "Evento", render: (r) => {
          const link = el("span", { class: "link-strong", style: "cursor:pointer" }, r.title);
          link.onclick = () => eventDetail(r.id, load);
          return link;
        } },
        { header: "Cliente", render: (r) => r.clientName || "—" },
        { header: "Tipo", render: (r) => r.eventTypeName || "—" },
        { header: "Data", render: (r) => formatDate(r.eventDate) },
        { header: "Convidados", align: "center", render: (r) => r.guestCount ? String(r.guestCount) : "—" },
        { header: "Status", render: (r) => {
          const st = EVENT_STATUS[r.status] || { label: r.status, cls: "" };
          return el("span", { class: `badge ${st.cls}` }, st.label);
        } },
      ],
      rows: eventos,
      empty: { title: "Nenhum evento encontrado", desc: "Crie um evento para organizar o ciclo completo — do planejamento ao pós-evento." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Eventos"),
          el("p", {}, "O centro do ERP — cada evento reúne comercial, operacional e financeiro."),
        ]),
        el("div", { class: "flex items-center gap-2" }, [typesBtn, novo]),
      ]),
      chips,
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
