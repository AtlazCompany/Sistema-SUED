// View Financeiro: resumo, contas a receber, a pagar e fluxo de caixa.
import { api } from "../api.js";
import { el, formatBRL, formatDate, toCents, centsToReais, todayISO } from "../utils.js";
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

const dayOf = (d) => (d ? String(d).slice(0, 10) : "");

// Atrasada = pendente com vencimento ANTES de hoje (vence hoje ainda não é atraso).
function isOverdue(row) {
  return row.status === "PENDENTE" && !!row.dueDate && dayOf(row.dueDate) < todayISO();
}

const isDone = (row) => row.status === "PAGO" || row.status === "RECEBIDO";

// Status "visual" de uma conta: atrasado é calculado, não existe no banco.
const viewStatus = (row) => (isOverdue(row) ? "ATRASADO" : row.status);

// Modal de conta (receber ou pagar): nova (com parcelas) ou edição.
async function contaForm(kind, onSaved, existing = null) {
  const isPay = kind === "pagar";
  const done = existing && isDone(existing);
  const opts = await api.get("/financeiro/opcoes");

  const fields = done
    ? [field("Descrição", "description", existing.description, { required: true, col2: true })]
    : [
        field("Descrição", "description", existing?.description || "", { required: true, col2: true }),
        field("Valor (R$)", "amount", existing ? centsToReais(existing.amountCents) : "", { placeholder: "0,00", required: true }),
        field("Vencimento", "dueDate", dayOf(existing?.dueDate), { type: "date" }),
        field("Evento", "eventId", existing?.eventId || "", { type: "select", options: [
          { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
        ], col2: !isPay }),
        ...(isPay ? [field("Fornecedor", "supplierId", existing?.supplierId || "", { type: "select", options: [
          { value: "", label: "—" }, ...opts.suppliers.map((s) => ({ value: s.id, label: s.name })),
        ] })] : []),
      ];

  // Parcelas só na criação.
  let parcelasPreview = null;
  if (!existing) {
    const parcelas = field("Parcelas", "installments", "1", { type: "number" });
    const input = parcelas.querySelector("input");
    input.min = "1"; input.max = "36"; input.step = "1";
    parcelasPreview = el("p", { class: "text-muted text-sm col-2", style: "margin:0" }, "");
    fields.push(parcelas, parcelasPreview);
  }

  const form = el("form", { class: "form-grid" }, fields);

  function refreshPreview() {
    if (!parcelasPreview) return;
    const n = Math.floor(Number(form.elements.installments.value)) || 1;
    const valor = toCents(form.elements.amount.value);
    parcelasPreview.textContent = n > 1
      ? `${n} parcelas de ${formatBRL(valor)} = ${formatBRL(n * valor)}. O valor acima é de cada parcela; os vencimentos são mensais a partir da data informada.`
      : "";
  }
  form.addEventListener("input", refreshPreview);

  const save = el("button", { class: "btn btn--primary", type: "button" }, existing ? "Salvar" : "Adicionar");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const kindLabel = isPay ? "conta a pagar" : "conta a receber";
  const modal = openModal({
    title: existing ? `Editar ${kindLabel}` : `Nova ${kindLabel}`,
    body: done
      ? el("div", {}, [
          el("p", { class: "text-muted text-sm", style: "margin:0 0 12px" },
            `Esta conta já foi ${isPay ? "paga" : "recebida"}: só a descrição pode ser alterada. Para mudar valor, vencimento ou evento, estorne primeiro.`),
          form,
        ])
      : form,
    footer: [cancel, save],
  });
  cancel.onclick = modal.close;
  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.description?.trim()) return toast("Informe a descrição.", "error");
    if (Number(body.installments) > 1 && !body.dueDate) return toast("Para parcelar, informe o vencimento da primeira parcela.", "error");
    save.disabled = true;
    try {
      if (existing) await api.put(`/financeiro/${kind}/${existing.id}`, body);
      else await api.post(`/financeiro/${kind}`, body);
      modal.close();
      toast(existing ? "Conta atualizada." : Number(body.installments) > 1 ? `${body.installments} parcelas adicionadas.` : "Conta adicionada.");
      onSaved();
    } catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

// Modal de liquidação: pergunta o dia em que o dinheiro de fato saiu/entrou.
function liquidarForm(kind, row, onSaved) {
  const isPay = kind === "pagar";
  const form = el("form", { class: "form-grid" }, [
    el("p", { class: "col-2", style: "margin:0" }, [
      el("strong", {}, row.description), ` — ${formatBRL(row.amountCents)}`,
    ]),
    field(isPay ? "Data do pagamento" : "Data do recebimento", "date", todayISO(), { type: "date", required: true, col2: true }),
  ]);
  form.elements.date.max = todayISO();
  const ok = el("button", { class: "btn btn--primary", type: "button" }, isPay ? "Confirmar pagamento" : "Confirmar recebimento");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isPay ? "Pagar conta" : "Receber conta", body: form, footer: [cancel, ok] });
  cancel.onclick = modal.close;
  ok.onclick = async () => {
    const date = form.elements.date.value;
    if (!date) return toast("Informe a data.", "error");
    ok.disabled = true;
    try {
      await api.post(`/financeiro/${kind}/${row.id}/${kind}`, { date });
      modal.close();
      toast(isPay ? "Conta paga." : "Recebimento registrado.");
      onSaved();
    } catch (err) { toast(err.message, "error"); ok.disabled = false; }
  };
}

// Filtros da lista de contas (ficam guardados ao trocar de aba).
const STATUS_FILTERS = (isPay) => [
  ["PENDENTE", "Pendentes"],
  ["ATRASADO", "Atrasadas"],
  ["DONE", isPay ? "Pagas" : "Recebidas"],
  ["CANCELADO", "Canceladas"],
  ["TODAS", "Todas"],
];

function matchesFilter(row, f) {
  const vs = viewStatus(row);
  if (f.status === "PENDENTE" && row.status !== "PENDENTE") return false; // atrasadas são pendentes também
  if (f.status === "ATRASADO" && vs !== "ATRASADO") return false;
  if (f.status === "DONE" && !isDone(row)) return false;
  if (f.status === "CANCELADO" && row.status !== "CANCELADO") return false;
  const due = dayOf(row.dueDate);
  if (f.from && (!due || due < f.from)) return false;
  if (f.to && (!due || due > f.to)) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${row.description} ${row.eventTitle || ""} ${row.supplierName || ""}`.toLowerCase().includes(q)) return false;
  return true;
}

export async function renderFinanceiro() {
  const container = el("div", {});
  let tab = "resumo";
  const filters = {
    receber: { status: "PENDENTE", from: "", to: "", q: "" },
    pagar: { status: "PENDENTE", from: "", to: "", q: "" },
  };

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
    const atraso = (n, cents) => (n ? `${n} atrasada(s) · ${formatBRL(cents)}` : "em dia");
    body.replaceChildren(el("div", { class: "grid grid-kpis" }, [
      kpi("A receber (pendente)", formatBRL(r.aReceberCents), atraso(r.atrasadas, r.atrasadasReceberCents)),
      kpi("A pagar (pendente)", formatBRL(r.aPagarCents), atraso(r.atrasadasPagar, r.atrasadasPagarCents)),
      kpi("Saldo de caixa", formatBRL(r.saldoCents), null, r.saldoCents < 0 ? "var(--sued-danger)" : "var(--sued-success)"),
      kpi("Entradas / Saídas", `${formatBRL(r.entradasCents)}`, `Saídas ${formatBRL(r.saidasCents)}`),
    ]));
  }

  async function renderContas(kind) {
    const isPay = kind === "pagar";
    const f = filters[kind];
    const rows = await api.get(`/financeiro/${kind}`);
    const reload = () => render();

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>${isPay ? "Conta a pagar" : "Conta a receber"}</span>` });
    novo.onclick = () => contaForm(kind, reload);

    async function acao(promise, msg) {
      try { await promise; toast(msg); reload(); } catch (e) { toast(e.message, "error"); }
    }

    function actions(r) {
      const btns = [];
      const iconBtn = (name, title, onclick) => {
        const b = el("button", { class: "btn btn--icon btn--ghost", type: "button", title, "aria-label": title, html: icon(name, 15) });
        b.onclick = onclick;
        return b;
      };
      if (r.status === "PENDENTE") {
        const liq = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, isPay ? "Pagar" : "Receber");
        liq.onclick = () => liquidarForm(kind, r, reload);
        btns.push(liq);
      } else if (isDone(r)) {
        const est = el("button", { class: "btn btn--subtle btn--sm", type: "button", title: "Desfazer o lançamento e voltar a conta para pendente" }, "Estornar");
        est.onclick = () => {
          if (!confirm(`Estornar esta conta? Ela volta a ficar pendente e o lançamento sai do fluxo de caixa${r.eventId ? " e do realizado do evento" : ""}.`)) return;
          acao(api.post(`/financeiro/${kind}/${r.id}/estornar`), "Conta estornada.");
        };
        btns.push(est);
      }
      if (r.status !== "CANCELADO") btns.push(iconBtn("edit", "Editar", () => contaForm(kind, reload, r)));
      if (r.status === "PENDENTE") {
        btns.push(iconBtn("x", "Cancelar conta", () => {
          if (!confirm("Cancelar esta conta? Ela deixa de contar nos totais e não pode ser reaberta.")) return;
          acao(api.post(`/financeiro/${kind}/${r.id}/cancelar`), "Conta cancelada.");
        }));
      }
      btns.push(iconBtn("trash", "Excluir", () => {
        const aviso = isDone(r)
          ? "Esta conta já foi liquidada. Excluir também remove o lançamento do fluxo de caixa e abate do realizado do evento. Excluir mesmo assim?"
          : "Excluir esta conta?";
        if (!confirm(aviso)) return;
        acao(api.del(`/financeiro/${kind}/${r.id}`), "Conta excluída.");
      }));
      return el("div", { class: "flex items-center row-actions" }, btns);
    }

    const listHost = el("div", {});

    function renderList() {
      const shown = rows.filter((r) => matchesFilter(r, f));
      const total = shown.reduce((a, r) => a + r.amountCents, 0);
      const atrasado = shown.filter(isOverdue).reduce((a, r) => a + r.amountCents, 0);
      const table = renderTable({
        columns: [
          { header: "Descrição", render: (r) => el("span", { class: "font-medium" }, r.description) },
          ...(isPay ? [{ header: "Fornecedor", render: (r) => r.supplierName || "—" }] : []),
          { header: "Evento", render: (r) => r.eventTitle || "—" },
          { header: "Vencimento", render: (r) => el("span", { style: isOverdue(r) ? "color:var(--sued-danger);font-weight:500" : "" }, r.dueDate ? formatDate(r.dueDate) : "—") },
          { header: isPay ? "Pago em" : "Recebido em", render: (r) => {
            const d = isPay ? r.paidDate : r.receivedDate;
            return d ? formatDate(d) : "—";
          } },
          { header: "Valor", align: "right", render: (r) => el("span", { class: "font-semibold" }, formatBRL(r.amountCents)) },
          { header: "Status", render: (r) => {
            const s = FIN_STATUS[viewStatus(r)] || { label: r.status, cls: "" };
            return el("span", { class: `badge ${s.cls}` }, s.label);
          } },
          { header: "", align: "right", render: actions },
        ],
        rows: shown,
        empty: rows.length
          ? { title: "Nenhuma conta com esses filtros", desc: "Ajuste o status, o período ou a busca." }
          : { title: isPay ? "Nenhuma conta a pagar" : "Nenhuma conta a receber", desc: "Adicione lançamentos financeiros." },
      });
      listHost.replaceChildren(
        el("div", { class: "text-muted text-sm", style: "margin-bottom:10px" },
          `${shown.length} conta(s) · total ${formatBRL(total)}${atrasado ? ` · atrasado ${formatBRL(atrasado)}` : ""}`),
        el("div", { class: "card" }, [table]),
      );
    }

    // ----- filtros -----
    const chips = STATUS_FILTERS(isPay).map(([value, label]) => {
      const chip = el("button", { class: `chip ${f.status === value ? "is-active" : ""}`, type: "button" }, label);
      chip.onclick = () => {
        f.status = value;
        chips.forEach((c, i) => c.classList.toggle("is-active", STATUS_FILTERS(isPay)[i][0] === value));
        renderList();
      };
      return chip;
    });
    const from = el("input", { class: "input input--mini", type: "date", value: f.from, "aria-label": "Vencimento de" });
    const to = el("input", { class: "input input--mini", type: "date", value: f.to, "aria-label": "Vencimento até" });
    const q = el("input", { class: "input input--mini", type: "search", value: f.q, placeholder: "Buscar descrição, evento…", "aria-label": "Buscar", style: "min-width:200px" });
    from.onchange = () => { f.from = from.value; renderList(); };
    to.onchange = () => { f.to = to.value; renderList(); };
    q.oninput = () => { f.q = q.value; renderList(); };

    body.replaceChildren(
      el("div", { class: "flex items-center justify-between mb-3" }, [
        el("span", { class: "text-muted text-sm" }, isPay ? "Contas a pagar" : "Contas a receber"), novo,
      ]),
      el("div", { class: "filter-chips" }, chips),
      el("div", { class: "flex items-center gap-2 mb-3", style: "flex-wrap:wrap" }, [
        el("span", { class: "text-muted text-sm" }, "Vencimento de"), from,
        el("span", { class: "text-muted text-sm" }, "até"), to, q,
      ]),
      listHost,
    );
    renderList();
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
