// View Financeiro: resumo, contas a receber, a pagar e fluxo de caixa.
import { api } from "../api.js";
import { el, formatBRL, formatDate, formatPercent, toCents, centsToReais, todayISO } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";
import { TAX_RATE_PERCENT } from "../budget-math.js";

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

// Caixinha de marcar ocupando a linha toda do formulário.
function checkField(label, hint, checked) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!checked;
  const wrap = el("label", { class: "field field--check col-2" }, [
    input,
    el("span", {}, [label, hint ? el("span", { class: "text-muted text-sm", style: "display:block" }, hint) : null]),
  ]);
  return { wrap, input };
}

const TAX_RECEIVE_HINT = `O valor já inclui os ${TAX_RATE_PERCENT}% de impostos: a parte de imposto (1/6) é reservada quando o dinheiro entra.`;
const TAX_PAY_HINT = "Ao pagar, o valor abate a reserva de impostos.";

// ----- Categorias (de entrada ou de saída) -----
const categoryOptions = (categories, kind) => [
  { value: "", label: "Sem categoria" },
  ...categories.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.name })),
];

// Troca as opções do <select> de categoria (o tipo do lançamento pode mudar).
function fillCategorySelect(select, categories, kind, value = "") {
  select.replaceChildren(...categoryOptions(categories, kind).map((o) => {
    const node = el("option", { value: o.value }, o.label);
    if (o.value === value) node.selected = true;
    return node;
  }));
}

// Filtro de categoria das listas: todas, sem categoria ou uma específica. Sem
// `kind` (fluxo de caixa), mostra as de entrada e as de saída separadas.
function categoryFilter(categories, kind, value) {
  const opt = (c) => el("option", { value: c.id }, c.name);
  const groups = kind
    ? categories.filter((c) => c.kind === kind).map(opt)
    : [["ENTRADA", "Entradas"], ["SAIDA", "Saídas"]].map(([k, label]) =>
        el("optgroup", { label }, categories.filter((c) => c.kind === k).map(opt)));
  const select = el("select", { class: "select input--mini", "aria-label": "Categoria" }, [
    el("option", { value: "" }, "Todas as categorias"),
    el("option", { value: "none" }, "Sem categoria"),
    ...groups,
  ]);
  select.value = value;
  return select;
}

// Marcar "É pagamento de impostos" já escolhe a categoria Impostos, se nenhuma foi escolhida.
function taxPicksCategory(taxInput, select, categories) {
  taxInput.addEventListener("change", () => {
    if (!taxInput.checked || select.value) return;
    const impostos = categories.find((c) => c.kind === "SAIDA" && c.name.trim().toLowerCase() === "impostos");
    if (impostos) select.value = impostos.id;
  });
}

// Modal de conta (receber ou pagar): nova (com parcelas) ou edição.
async function contaForm(kind, onSaved, existing = null) {
  const isPay = kind === "pagar";
  const done = existing && isDone(existing);
  const opts = await api.get("/financeiro/opcoes");
  const taxBox = done ? null : isPay
    ? checkField("É pagamento de impostos", TAX_PAY_HINT, existing?.isTax)
    : checkField(`Inclui impostos (${TAX_RATE_PERCENT}%)`, TAX_RECEIVE_HINT, existing ? existing.taxRatePercent > 0 : false);

  const categoria = field("Categoria", "categoryId", existing?.categoryId || "", {
    type: "select", options: categoryOptions(opts.categories, isPay ? "SAIDA" : "ENTRADA"), col2: isPay || done,
  });
  const fields = done
    ? [field("Descrição", "description", existing.description, { required: true, col2: true }), categoria]
    : [
        field("Descrição", "description", existing?.description || "", { required: true, col2: true }),
        field("Valor (R$)", "amount", existing ? centsToReais(existing.amountCents) : "", { placeholder: "0,00", required: true }),
        field("Vencimento", "dueDate", dayOf(existing?.dueDate), { type: "date" }),
        categoria,
        field("Evento", "eventId", existing?.eventId || "", { type: "select", options: [
          { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
        ] }),
        ...(isPay ? [field("Fornecedor", "supplierId", existing?.supplierId || "", { type: "select", options: [
          { value: "", label: "—" }, ...opts.suppliers.map((s) => ({ value: s.id, label: s.name })),
        ] })] : []),
      ];

  if (taxBox) fields.push(taxBox.wrap);

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

  // Em contas a receber novas, "Inclui impostos" acompanha o evento escolhido
  // (marcado se ele tem orçamento aprovado com imposto) até o usuário mexer.
  if (taxBox && !isPay && !existing) {
    let touched = false;
    taxBox.input.addEventListener("change", () => { touched = true; });
    form.elements.eventId.addEventListener("change", () => {
      if (touched) return;
      taxBox.input.checked = !!opts.events.find((e) => e.id === form.elements.eventId.value)?.hasTaxedBudget;
    });
  }
  if (taxBox && isPay) taxPicksCategory(taxBox.input, form.elements.categoryId, opts.categories);

  const save = el("button", { class: "btn btn--primary", type: "button" }, existing ? "Salvar" : "Adicionar");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const kindLabel = isPay ? "conta a pagar" : "conta a receber";
  const modal = openModal({
    title: existing ? `Editar ${kindLabel}` : `Nova ${kindLabel}`,
    body: done
      ? el("div", {}, [
          el("p", { class: "text-muted text-sm", style: "margin:0 0 12px" },
            `Esta conta já foi ${isPay ? "paga" : "recebida"}: só a descrição e a categoria podem ser alteradas. Para mudar valor, vencimento ou evento, estorne primeiro.`),
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
    if (taxBox) body[isPay ? "isTax" : "includesTax"] = taxBox.input.checked;
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

// Data local → "AAAA-MM-DD" (os presets de período são calculados no navegador).
const isoLocal = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const monthRange = (offset) => {
  const now = new Date();
  return [isoLocal(new Date(now.getFullYear(), now.getMonth() + offset, 1)), isoLocal(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))];
};
const FLUXO_PRESETS = [
  ["mes", "Este mês", () => monthRange(0)],
  ["anterior", "Mês anterior", () => monthRange(-1)],
  ["90d", "Últimos 90 dias", () => [isoLocal(new Date(Date.now() - 89 * 86400e3)), todayISO()]],
  ["ano", "Este ano", () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`]],
  ["tudo", "Tudo", () => ["", ""]],
];

// Modal de lançamento avulso (direto no caixa, sem conta a pagar/receber).
async function lancamentoForm(onSaved) {
  const opts = await api.get("/financeiro/opcoes");
  const form = el("form", { class: "form-grid" }, [
    field("Tipo", "type", "ENTRADA", { type: "select", col2: true, options: [
      { value: "ENTRADA", label: "Entrada" },
      { value: "SAIDA", label: "Saída" },
      { value: "INICIAL", label: "Saldo inicial (entrada)" },
    ] }),
    field("Descrição", "description", "", { required: true, col2: true }),
    field("Valor (R$)", "amount", "", { placeholder: "0,00", required: true }),
    field("Data", "date", todayISO(), { type: "date", required: true }),
    field("Categoria", "categoryId", "", { type: "select", options: categoryOptions(opts.categories, "ENTRADA") }),
    field("Evento (opcional)", "eventId", "", { type: "select", options: [
      { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
    ] }),
  ]);
  form.elements.date.max = todayISO();
  const txKind = () => (form.elements.type.value === "SAIDA" ? "SAIDA" : "ENTRADA");

  // Caixinha de imposto: muda de sentido conforme o tipo (entrada inclui
  // impostos / saída é pagamento de imposto) e some no saldo inicial.
  const taxBox = checkField("", "", false);
  const taxLabel = taxBox.wrap.querySelector("span");
  form.append(taxBox.wrap);
  function syncTaxBox() {
    const type = form.elements.type.value;
    taxBox.wrap.style.display = type === "INICIAL" ? "none" : "flex";
    taxBox.input.checked = false;
    taxLabel.replaceChildren(
      type === "SAIDA" ? "É pagamento de impostos" : `Inclui impostos (${TAX_RATE_PERCENT}%)`,
      el("span", { class: "text-muted text-sm", style: "display:block" }, type === "SAIDA" ? TAX_PAY_HINT : TAX_RECEIVE_HINT),
    );
  }
  syncTaxBox();
  taxPicksCategory(taxBox.input, form.elements.categoryId, opts.categories);

  // "Saldo inicial" é só uma entrada com descrição pronta.
  let kindShown = txKind();
  form.elements.type.onchange = () => {
    syncTaxBox();
    if (txKind() !== kindShown) {
      kindShown = txKind();
      fillCategorySelect(form.elements.categoryId, opts.categories, kindShown);
    }
    if (form.elements.type.value === "INICIAL" && !form.elements.description.value.trim())
      form.elements.description.value = "Saldo inicial";
  };
  const save = el("button", { class: "btn btn--primary", type: "button" }, "Adicionar");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: "Lançamento avulso", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;
  save.onclick = async () => {
    const f = Object.fromEntries(new FormData(form));
    if (!f.description?.trim()) return toast("Informe a descrição.", "error");
    save.disabled = true;
    try {
      await api.post("/financeiro/lancamentos", {
        kind: f.type === "SAIDA" ? "SAIDA" : "ENTRADA",
        description: f.description, amount: f.amount, date: f.date, eventId: f.eventId, categoryId: f.categoryId,
        includesTax: f.type === "ENTRADA" && taxBox.input.checked,
        isTax: f.type === "SAIDA" && taxBox.input.checked,
      });
      modal.close();
      toast("Lançamento adicionado.");
      onSaved();
    } catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

// Cadastro de categorias: criar, renomear e excluir (as em uso não saem).
// `onChanged` redesenha a aba aberta por trás do modal.
async function categoriasModal(onChanged) {
  const listBox = el("div", {});
  const iconBtn = (name, title, onclick) => {
    const b = el("button", { class: "btn btn--icon btn--ghost", type: "button", title, "aria-label": title, html: icon(name, 15) });
    b.onclick = onclick;
    return b;
  };
  async function changed(promise) {
    try { await promise; await reload(); onChanged(); return true; }
    catch (err) { toast(err.message, "error"); return false; }
  }

  function row(c) {
    const li = el("li", { class: "flex items-center justify-between gap-2 list-row" });
    const show = () => li.replaceChildren(
      el("span", {}, c.name),
      el("span", { class: "flex items-center gap-2" }, [
        el("span", { class: "text-muted" }, c.uses ? `${c.uses} uso(s)` : "sem uso"),
        iconBtn("edit", `Renomear ${c.name}`, edit),
        iconBtn("trash", `Excluir ${c.name}`, () => {
          if (confirm(`Excluir a categoria "${c.name}"?`)) changed(api.del(`/financeiro/categorias/${c.id}`));
        }),
      ]),
    );
    function edit() {
      const input = el("input", { class: "input input--mini flex-1", value: c.name, "aria-label": "Novo nome da categoria" });
      const save = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Salvar");
      const cancel = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "Cancelar");
      const submit = () => changed(api.put(`/financeiro/categorias/${c.id}`, { name: input.value }));
      save.onclick = submit;
      cancel.onclick = show;
      input.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        if (e.key === "Escape") { e.stopPropagation(); show(); } // Esc cancela a edição, não fecha o modal
      };
      li.replaceChildren(input, save, cancel);
      input.focus();
    }
    show();
    return li;
  }

  async function reload() {
    const cats = await api.get("/financeiro/categorias");
    const section = (kind, title) => {
      const items = cats.filter((c) => c.kind === kind);
      return el("div", { class: "mb-4" }, [
        el("div", { class: "subsection-title" }, title),
        items.length
          ? el("ul", { class: "list-none" }, items.map(row))
          : el("p", { class: "text-muted text-sm" }, "Nenhuma categoria."),
      ]);
    };
    listBox.replaceChildren(section("SAIDA", "Saídas"), section("ENTRADA", "Entradas"));
  }
  await reload();

  const name = el("input", { class: "input flex-1", placeholder: "Nova categoria", "aria-label": "Nome da nova categoria", style: "min-width:160px" });
  const kind = el("select", { class: "select", "aria-label": "Tipo da nova categoria", style: "width:auto" }, [
    el("option", { value: "SAIDA" }, "Saída"),
    el("option", { value: "ENTRADA" }, "Entrada"),
  ]);
  const add = el("button", { class: "btn btn--subtle", type: "button" }, "Adicionar");
  const submit = async () => {
    if (!name.value.trim()) return toast("Informe o nome da categoria.", "error");
    if (await changed(api.post("/financeiro/categorias", { name: name.value, kind: kind.value }))) name.value = "";
  };
  add.onclick = submit;
  name.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");
  const modal = openModal({
    title: "Categorias do financeiro",
    body: el("div", {}, [
      el("p", { class: "text-muted text-sm", style: "margin:0 0 14px" },
        "Contas a pagar usam categorias de saída; contas a receber, de entrada. Uma categoria em uso pode ser renomeada, mas não excluída."),
      listBox,
      el("div", { class: "flex items-center gap-2", style: "flex-wrap:wrap" }, [name, kind, add]),
    ]),
    footer: [closeBtn],
  });
  closeBtn.onclick = modal.close;
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
  if (f.category === "none" && row.categoryId) return false;
  if (f.category && f.category !== "none" && row.categoryId !== f.category) return false;
  const due = dayOf(row.dueDate);
  if (f.from && (!due || due < f.from)) return false;
  if (f.to && (!due || due > f.to)) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${row.description} ${row.eventTitle || ""} ${row.supplierName || ""} ${row.categoryName || ""}`.toLowerCase().includes(q)) return false;
  return true;
}

export async function renderFinanceiro() {
  const container = el("div", {});
  let tab = "resumo";
  const filters = {
    receber: { status: "PENDENTE", from: "", to: "", q: "", category: "" },
    pagar: { status: "PENDENTE", from: "", to: "", q: "", category: "" },
  };

  const fluxo = { preset: "mes", from: "", to: "", category: "" };
  [fluxo.from, fluxo.to] = FLUXO_PRESETS[0][2]();

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
    const signed = (cents) => (cents < 0 ? "var(--sued-danger)" : "var(--sued-success)");
    const h2 = (text) => el("h2", { style: "font-size:14px;font-weight:600;margin-bottom:12px" }, text);
    const row = (label, value, color) => el("div", { class: "budget-totals__row" }, [
      el("span", { class: "text-muted" }, label),
      el("span", { style: `font-weight:600${color ? `;color:${color}` : ""}` }, value),
    ]);

    const mesNome = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const mesCard = el("div", { class: "card card--pad" }, [
      h2(`Este mês · ${mesNome}`),
      el("div", { class: "budget-totals" }, [
        row("Entradas", formatBRL(r.mes.entradasCents)),
        row("Saídas", formatBRL(r.mes.saidasCents)),
        row("Resultado", formatBRL(r.mes.resultadoCents), signed(r.mes.resultadoCents)),
      ]),
    ]);

    const res = r.reservaImpostos;
    const reservaCard = el("div", { class: "card card--pad" }, [
      h2("Reserva de impostos"),
      el("div", { class: "budget-totals" }, [
        row("Reservado (do que já entrou)", formatBRL(res.reservadoCents)),
        row("Impostos já pagos", "− " + formatBRL(res.pagoCents)),
        row("Saldo da reserva", formatBRL(res.saldoCents), "var(--sued-gold-dark)"),
      ]),
      el("p", { class: "text-muted text-sm", style: "margin:12px 0 0" },
        res.aReservarCents
          ? `Mais ${formatBRL(res.aReservarCents)} de imposto ainda vai entrar com as contas a receber pendentes.`
          : "Esse dinheiro está no caixa, mas não é seu: separe-o para pagar os impostos."),
    ]);

    const proximosCard = el("div", { class: "card card--pad" }, [
      h2("Próximos vencimentos"),
      ...(r.proximos.length
        ? r.proximos.map((p) => el("div", { class: "op-item" }, [
            el("span", { class: `badge ${p.kind === "receber" ? "badge--success" : "badge--danger"}` }, p.kind === "receber" ? "Receber" : "Pagar"),
            el("span", { style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, p.description),
            el("span", { class: "text-muted text-sm" }, formatDate(p.dueDate)),
            el("span", { class: "font-semibold" }, formatBRL(p.amountCents)),
          ]))
        : [el("p", { class: "text-muted text-sm", style: "margin:0" }, "Nenhuma conta pendente a vencer.")]),
    ]);

    const previsaoCard = el("div", { class: "card card--pad" }, [
      h2("Previsão de caixa"),
      renderTable({
        columns: [
          { header: "Até", render: (p) => `${p.dias} dias` },
          { header: "A receber", align: "right", render: (p) => formatBRL(p.receberCents) },
          { header: "A pagar", align: "right", render: (p) => formatBRL(p.pagarCents) },
          { header: "Saldo projetado", align: "right", render: (p) =>
            el("span", { class: "font-semibold", style: `color:${signed(p.saldoProjetadoCents)}` }, formatBRL(p.saldoProjetadoCents)) },
          { header: "Reserva de impostos", align: "right", render: (p) => formatBRL(p.reservaCents) },
          { header: "Saldo livre", align: "right", render: (p) =>
            el("span", { class: "font-semibold", style: `color:${signed(p.saldoLivreProjetadoCents)}` }, formatBRL(p.saldoLivreProjetadoCents)) },
        ],
        rows: r.previsao,
      }),
      el("p", { class: "text-muted text-sm", style: "margin:12px 0 0" },
        `Saldo projetado = saldo de caixa de hoje (${formatBRL(r.saldoCents)}) + a receber − a pagar até a data. A reserva projetada soma o imposto dos recebimentos pendentes e desconta os pagamentos de imposto a vencer; saldo livre = projetado − reserva. Inclui contas já vencidas e ainda pendentes.` +
        (r.semVencimento.receberCents || r.semVencimento.pagarCents
          ? ` Fora da previsão, por não terem vencimento: ${formatBRL(r.semVencimento.receberCents)} a receber e ${formatBRL(r.semVencimento.pagarCents)} a pagar.`
          : "")),
    ]);

    // Para onde foi o dinheiro: saídas do mês por categoria. Clicar abre o
    // fluxo de caixa do mês filtrado pela categoria.
    const gastos = r.gastosPorCategoria;
    const totalGastos = gastos.reduce((a, g) => a + g.amountCents, 0);
    const verCategoria = (g) => {
      tab = "fluxo";
      fluxo.preset = "mes";
      [fluxo.from, fluxo.to] = FLUXO_PRESETS[0][2]();
      fluxo.category = g.categoryId || "none";
      render();
    };
    const gastosCard = el("div", { class: "card card--pad" }, [
      h2(`Para onde foi o dinheiro · ${mesNome}`),
      ...(gastos.length
        ? gastos.map((g) => {
            const pct = totalGastos ? (g.amountCents / totalGastos) * 100 : 0;
            const item = el("button", { class: "cat-spend", type: "button", title: "Ver os lançamentos desta categoria" }, [
              el("span", { class: "flex items-center justify-between text-sm mb-1" }, [
                el("span", { class: "font-medium" }, g.name),
                el("span", { class: "text-muted" }, `${formatBRL(g.amountCents)} · ${formatPercent(pct)}`),
              ]),
              el("span", { class: "progress block" }, [
                el("span", { class: `progress__fill ${g.categoryId ? "" : "progress__fill--muted"}`, style: `width:${pct}%` }),
              ]),
            ]);
            item.onclick = () => verCategoria(g);
            return item;
          })
        : [el("p", { class: "text-muted text-sm", style: "margin:0" }, "Nenhuma saída neste mês ainda.")]),
    ]);

    body.replaceChildren(
      el("div", { class: "grid grid-kpis mb-4" }, [
        kpi("A receber (pendente)", formatBRL(r.aReceberCents), atraso(r.atrasadas, r.atrasadasReceberCents)),
        kpi("A pagar (pendente)", formatBRL(r.aPagarCents), atraso(r.atrasadasPagar, r.atrasadasPagarCents)),
        kpi("Saldo de caixa", formatBRL(r.saldoCents), null, signed(r.saldoCents)),
        kpi("Saldo livre", formatBRL(res.saldoLivreCents), "caixa menos a reserva de impostos", signed(res.saldoLivreCents)),
        kpi("Entradas / Saídas", `${formatBRL(r.entradasCents)}`, `Saídas ${formatBRL(r.saidasCents)}`),
      ]),
      el("div", { class: "grid grid-main-side items-start" }, [
        el("div", { class: "flex", style: "flex-direction:column;gap:16px" }, [previsaoCard, gastosCard]),
        el("div", { class: "flex", style: "flex-direction:column;gap:16px" }, [reservaCard, mesCard, proximosCard]),
      ]),
    );
  }

  async function renderContas(kind) {
    const isPay = kind === "pagar";
    const f = filters[kind];
    const [rows, categories] = await Promise.all([api.get(`/financeiro/${kind}`), api.get("/financeiro/categorias")]);
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
          { header: "Descrição", render: (r) => el("span", { class: "font-medium" }, [
            r.description,
            (isPay ? r.isTax : r.taxRatePercent > 0)
              ? el("span", { class: "badge badge--muted", style: "margin-left:8px" }, isPay ? "Imposto" : `Inclui ${r.taxRatePercent}% imp.`)
              : null,
          ]) },
          { header: "Categoria", render: (r) => r.categoryName || "—" },
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
          ? { title: "Nenhuma conta com esses filtros", desc: "Ajuste o status, o período, a categoria ou a busca." }
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
    const q = el("input", { class: "input input--mini flex-1", type: "search", value: f.q, placeholder: "Buscar descrição, evento…", "aria-label": "Buscar", style: "min-width:200px" });
    const cat = categoryFilter(categories, isPay ? "SAIDA" : "ENTRADA", f.category);
    from.onchange = () => { f.from = from.value; renderList(); };
    to.onchange = () => { f.to = to.value; renderList(); };
    q.oninput = () => { f.q = q.value; renderList(); };
    cat.onchange = () => { f.category = cat.value; renderList(); };

    body.replaceChildren(
      el("div", { class: "flex items-center justify-between mb-3" }, [
        el("span", { class: "text-muted text-sm" }, isPay ? "Contas a pagar" : "Contas a receber"), novo,
      ]),
      el("div", { class: "filter-chips" }, chips),
      el("div", { class: "filter-row" }, [
        el("span", { class: "text-muted text-sm" }, "Vencimento de"), from,
        el("span", { class: "text-muted text-sm" }, "até"), to, cat, q,
      ]),
      listHost,
    );
    renderList();
  }

  async function renderFluxo() {
    const params = new URLSearchParams();
    if (fluxo.from) params.set("from", fluxo.from);
    if (fluxo.to) params.set("to", fluxo.to);
    if (fluxo.category) params.set("categoryId", fluxo.category);
    const [ext, categories] = await Promise.all([
      api.get(`/financeiro/extrato${params.size ? `?${params}` : ""}`),
      api.get("/financeiro/categorias"),
    ]);
    const color = (cents) => (cents < 0 ? "var(--sued-danger)" : "var(--sued-success)");
    // Filtrando por categoria, saldo de caixa não faz sentido: só entradas e saídas dela.
    const byCategory = !!fluxo.category;

    // ----- período -----
    const chips = FLUXO_PRESETS.map(([value, label, range]) => {
      const chip = el("button", { class: `chip ${fluxo.preset === value ? "is-active" : ""}`, type: "button" }, label);
      chip.onclick = () => { fluxo.preset = value; [fluxo.from, fluxo.to] = range(); render(); };
      return chip;
    });
    const from = el("input", { class: "input input--mini", type: "date", value: fluxo.from, "aria-label": "Data inicial" });
    const to = el("input", { class: "input input--mini", type: "date", value: fluxo.to, "aria-label": "Data final" });
    const custom = () => { fluxo.preset = "custom"; fluxo.from = from.value; fluxo.to = to.value; render(); };
    from.onchange = custom;
    to.onchange = custom;
    const cat = categoryFilter(categories, null, fluxo.category);
    cat.onchange = () => { fluxo.category = cat.value; render(); };

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Lançamento avulso</span>` });
    novo.onclick = () => lancamentoForm(render);

    const kpi = (label, value, c) => el("div", { class: "card kpi" }, [
      el("div", { class: "kpi__label" }, label),
      el("div", { class: "kpi__value", style: `font-size:24px${c ? `;color:${c}` : ""}` }, value),
    ]);

    const table = renderTable({
      columns: [
        { header: "Data", render: (r) => formatDate(r.date) },
        { header: "Descrição", render: (r) => el("span", {}, [
          r.description,
          r.avulso ? el("span", { class: "badge badge--muted", style: "margin-left:8px" }, "Avulso") : null,
          r.isTax ? el("span", { class: "badge badge--muted", style: "margin-left:8px" }, "Imposto") : null,
          r.taxReserveCents > 0 ? el("span", { class: "badge badge--muted", style: "margin-left:8px" }, `Reserva ${formatBRL(r.taxReserveCents)}`) : null,
        ]) },
        { header: "Categoria", render: (r) => r.categoryName || "—" },
        { header: "Evento", render: (r) => r.eventTitle || "—" },
        { header: "Tipo", render: (r) => el("span", { class: `badge ${r.kind === "ENTRADA" ? "badge--success" : "badge--danger"}` }, r.kind === "ENTRADA" ? "Entrada" : "Saída") },
        { header: "Valor", align: "right", render: (r) => el("span", { style: `font-weight:600;color:${r.kind === "ENTRADA" ? "var(--sued-success)" : "var(--sued-danger)"}` }, `${r.kind === "ENTRADA" ? "+" : "−"} ${formatBRL(r.amountCents)}`) },
        ...(byCategory ? [] : [{ header: "Saldo", align: "right", render: (r) => el("span", { style: `color:${color(r.balanceCents)}` }, formatBRL(r.balanceCents)) }]),
        { header: "", align: "right", render: (r) => {
          if (!r.avulso) return "";
          const del = el("button", { class: "btn btn--icon btn--ghost", type: "button", title: "Excluir lançamento", "aria-label": "Excluir lançamento", html: icon("trash", 15) });
          del.onclick = async () => {
            if (!confirm("Excluir este lançamento avulso?")) return;
            try { await api.del(`/financeiro/lancamentos/${r.id}`); toast("Lançamento excluído."); render(); }
            catch (e) { toast(e.message, "error"); }
          };
          return del;
        } },
      ],
      rows: ext.rows,
      empty: { title: "Sem movimentações no período", desc: "Entradas e saídas aparecem quando contas são pagas/recebidas ou quando você faz um lançamento avulso." },
    });

    body.replaceChildren(
      el("div", { class: "flex items-center justify-between mb-3" }, [
        el("span", { class: "text-muted text-sm" }, "Fluxo de caixa"), novo,
      ]),
      el("div", { class: "filter-chips" }, chips),
      el("div", { class: "filter-row" }, [
        el("span", { class: "text-muted text-sm" }, "De"), from,
        el("span", { class: "text-muted text-sm" }, "até"), to, cat,
      ]),
      el("div", { class: "grid grid-kpis mb-4" }, byCategory
        ? [
            kpi("Entradas", formatBRL(ext.entradasCents), "var(--sued-success)"),
            kpi("Saídas", formatBRL(ext.saidasCents), "var(--sued-danger)"),
          ]
        : [
            kpi("Saldo inicial", formatBRL(ext.openingCents), color(ext.openingCents)),
            kpi("Entradas", formatBRL(ext.entradasCents), "var(--sued-success)"),
            kpi("Saídas", formatBRL(ext.saidasCents), "var(--sued-danger)"),
            kpi("Saldo final", formatBRL(ext.closingCents), color(ext.closingCents)),
          ]),
      ...(ext.truncated
        ? [el("p", { class: "text-sm", style: "color:var(--sued-danger)" }, "Há mais movimentações do que o limite exibido: reduza o período para ver o saldo correto.")]
        : []),
      el("div", { class: "card" }, [table]),
    );
  }

  const catBtn = el("button", { class: "btn btn--outline", type: "button" }, "Categorias");
  catBtn.onclick = () => categoriasModal(render);

  container.replaceChildren(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, "Financeiro"),
        el("p", {}, "Contas a pagar, a receber e o fluxo de caixa — liquidar atualiza o realizado do evento."),
      ]),
      catBtn,
    ]),
    tabsBar,
    body,
  );
  await render();
  return container;
}
