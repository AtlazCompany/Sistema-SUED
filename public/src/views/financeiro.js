// View Financeiro: resumo, contas a receber, a pagar e fluxo de caixa.
import { api } from "../api.js";
import { el, formatBRL, formatDate } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

const FIN_STATUS = {
  PENDENTE: { label: "Pendente", cls: "badge--gold" },
  PAGO: { label: "Pago", cls: "badge--success" },
  RECEBIDO: { label: "Recebido", cls: "badge--success" },
  ATRASADO: { label: "Atrasado", cls: "badge--danger" },
  CANCELADO: { label: "Cancelado", cls: "badge--muted" },
};

function isOverdue(row) {
  return row.status === "PENDENTE" && row.dueDate && new Date(row.dueDate) < new Date();
}

// Modal de nova conta (receber ou pagar)
async function contaForm(kind, onSaved) {
  const isPay = kind === "pagar";
  const opts = await api.get("/financeiro/opcoes");
  const form = el("form", { class: "form-grid" }, [
    field("Descrição", "description", "", { required: true, col2: true }),
    field("Valor (R$)", "amount", "", { placeholder: "0,00", required: true }),
    field("Vencimento", "dueDate", "", { type: "date" }),
    field("Evento", "eventId", "", { type: "select", options: [
      { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
    ], col2: !isPay }),
    ...(isPay ? [field("Fornecedor", "supplierId", "", { type: "select", options: [
      { value: "", label: "—" }, ...opts.suppliers.map((s) => ({ value: s.id, label: s.name })),
    ] })] : []),
  ]);
  const save = el("button", { class: "btn btn--primary", type: "button" }, "Adicionar");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isPay ? "Nova conta a pagar" : "Nova conta a receber", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;
  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.description?.trim()) return toast("Informe a descrição.", "error");
    save.disabled = true;
    try { await api.post(`/financeiro/${kind}`, body); modal.close(); toast("Conta adicionada."); onSaved(); }
    catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

export async function renderFinanceiro() {
  const container = el("div", {});
  let tab = "resumo";

  const tabsBar = el("div", { class: "filter-chips" },
    [["resumo", "Resumo"], ["receber", "A receber"], ["pagar", "A pagar"], ["fluxo", "Fluxo de caixa"]].map(([v, label]) => {
      const chip = el("button", { class: `chip ${tab === v ? "is-active" : ""}` }, label);
      chip.onclick = () => { tab = v; render(); };
      return chip;
    }));

  const body = el("div", {});

  async function render() {
    [...tabsBar.children].forEach((c, i) => c.classList.toggle("is-active", ["resumo", "receber", "pagar", "fluxo"][i] === tab));
    body.replaceChildren(el("div", { class: "center-screen", style: "height:160px" }, [el("div", { class: "spinner" })]));
    if (tab === "resumo") await renderResumo();
    else if (tab === "receber") await renderContas("receber");
    else if (tab === "pagar") await renderContas("pagar");
    else await renderFluxo();
  }

  async function renderResumo() {
    const r = await api.get("/financeiro/resumo");
    const kpi = (label, value, hint, color) => el("div", { class: "card kpi" }, [
      el("div", { class: "kpi__label" }, label),
      el("div", { class: "kpi__value", style: color ? `color:${color}` : "" }, value),
      hint && el("div", { class: "kpi__hint" }, hint),
    ]);
    body.replaceChildren(el("div", { class: "grid grid-kpis" }, [
      kpi("A receber (pendente)", formatBRL(r.aReceberCents), r.atrasadas ? `${r.atrasadas} atrasada(s)` : "em dia"),
      kpi("A pagar (pendente)", formatBRL(r.aPagarCents)),
      kpi("Saldo de caixa", formatBRL(r.saldoCents), null, r.saldoCents < 0 ? "var(--sued-danger)" : "var(--sued-success)"),
      kpi("Entradas / Saídas", `${formatBRL(r.entradasCents)}`, `Saídas ${formatBRL(r.saidasCents)}`),
    ]));
  }

  async function renderContas(kind) {
    const isPay = kind === "pagar";
    const rows = await api.get(`/financeiro/${kind}`);
    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>${isPay ? "Conta a pagar" : "Conta a receber"}</span>` });
    novo.onclick = () => contaForm(kind, render);

    const table = renderTable({
      columns: [
        { header: "Descrição", render: (r) => el("span", { style: "font-weight:500" }, r.description) },
        ...(isPay ? [{ header: "Fornecedor", render: (r) => r.supplierName || "—" }] : []),
        { header: "Evento", render: (r) => r.eventTitle || "—" },
        { header: "Vencimento", render: (r) => el("span", { style: isOverdue(r) ? "color:var(--sued-danger);font-weight:500" : "" }, r.dueDate ? formatDate(r.dueDate) : "—") },
        { header: "Valor", align: "right", render: (r) => el("span", { style: "font-weight:600" }, formatBRL(r.amountCents)) },
        { header: "Status", render: (r) => {
          const s = FIN_STATUS[isOverdue(r) ? "ATRASADO" : r.status] || { label: r.status, cls: "" };
          return el("span", { class: `badge ${s.cls}` }, s.label);
        } },
        { header: "", align: "right", render: (r) => {
          const done = r.status === "PAGO" || r.status === "RECEBIDO";
          const btns = [];
          if (!done) {
            const liq = el("button", { class: "btn btn--subtle btn--sm" }, isPay ? "Pagar" : "Receber");
            liq.onclick = async () => {
              try { await api.post(`/financeiro/${kind}/${r.id}/${kind === "pagar" ? "pagar" : "receber"}`); toast(isPay ? "Conta paga." : "Recebimento registrado."); render(); }
              catch (e) { toast(e.message, "error"); }
            };
            btns.push(liq);
          }
          const del = el("button", { class: "btn btn--icon btn--ghost", html: icon("trash", 15) });
          del.onclick = async () => { if (confirm("Excluir esta conta?")) { try { await api.del(`/financeiro/${kind}/${r.id}`); render(); } catch (e) { toast(e.message, "error"); } } };
          btns.push(del);
          return el("div", { class: "flex items-center", style: "justify-content:flex-end;gap:4px" }, btns);
        } },
      ],
      rows,
      empty: { title: isPay ? "Nenhuma conta a pagar" : "Nenhuma conta a receber", desc: "Adicione lançamentos financeiros." },
    });

    body.replaceChildren(
      el("div", { class: "flex items-center justify-between", style: "margin-bottom:12px" }, [
        el("span", { class: "text-muted", style: "font-size:13px" }, isPay ? "Contas a pagar" : "Contas a receber"), novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  async function renderFluxo() {
    const rows = await api.get("/financeiro/fluxo");
    const table = renderTable({
      columns: [
        { header: "Data", render: (r) => formatDate(r.date) },
        { header: "Descrição", render: (r) => r.description },
        { header: "Evento", render: (r) => r.eventTitle || "—" },
        { header: "Tipo", render: (r) => el("span", { class: `badge ${r.kind === "ENTRADA" ? "badge--success" : "badge--danger"}` }, r.kind === "ENTRADA" ? "Entrada" : "Saída") },
        { header: "Valor", align: "right", render: (r) => el("span", { style: `font-weight:600;color:${r.kind === "ENTRADA" ? "var(--sued-success)" : "var(--sued-danger)"}` }, `${r.kind === "ENTRADA" ? "+" : "−"} ${formatBRL(r.amountCents)}`) },
      ],
      rows,
      empty: { title: "Sem movimentações", desc: "As entradas e saídas aparecem quando contas são liquidadas." },
    });
    body.replaceChildren(el("div", { class: "card" }, [table]));
  }

  container.replaceChildren(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, "Financeiro"),
        el("p", {}, "Contas a pagar, a receber e o fluxo de caixa — liquidar atualiza o realizado do evento."),
      ]),
    ]),
    tabsBar,
    body,
  );
  await render();
  return container;
}
