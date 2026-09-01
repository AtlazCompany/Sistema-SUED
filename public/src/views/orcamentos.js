// View de Orçamentos: lista + editor in-view (itens do catálogo, totais ao vivo).
import { api } from "../api.js";
import { el, formatBRL, formatDate, toCents, centsToReais } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";
import { renderOrcamentoDocumento } from "../components/orcamento-doc.js";

export const BUDGET_STATUS = {
  RASCUNHO: { label: "Rascunho", cls: "badge--muted" },
  ENVIADO: { label: "Enviado", cls: "badge--info" },
  APROVADO: { label: "Aprovado", cls: "badge--success" },
  REJEITADO: { label: "Rejeitado", cls: "badge--danger" },
  EXPIRADO: { label: "Expirado", cls: "badge--muted" },
};

export async function renderOrcamentos() {
  const container = el("div", {});

  // ---------------- LISTA ----------------
  async function loadList() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const budgets = await api.get("/orcamentos");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo orçamento</span>` });
    novo.onclick = () => openEditor(null);

    const table = renderTable({
      columns: [
        { header: "Número", render: (r) => {
          const link = el("span", { class: "link-strong", style: "cursor:pointer" }, r.number);
          link.onclick = () => openEditor(r.id);
          return link;
        } },
        { header: "Cliente", render: (r) => r.clientName || "—" },
        { header: "Evento", render: (r) => r.eventTitle || "—" },
        { header: "Total", align: "right", render: (r) =>
          el("span", { style: "font-weight:600" }, formatBRL(Number(r.subtotal) - r.discountCents)) },
        { header: "Validade", render: (r) => r.validUntil ? formatDate(r.validUntil) : "—" },
        { header: "Status", render: (r) => {
          const s = BUDGET_STATUS[r.status] || { label: r.status, cls: "" };
          return el("span", { class: `badge ${s.cls}` }, s.label);
        } },
      ],
      rows: budgets,
      empty: { title: "Nenhum orçamento", desc: "Crie um orçamento reutilizando itens do catálogo." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Orçamentos"),
          el("p", {}, "Monte orçamentos reaproveitando o catálogo — com totais e margem automáticos."),
        ]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  // ---------------- EDITOR ----------------
  async function openEditor(id) {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const opts = await api.get("/orcamentos/opcoes");
    const budget = id ? await api.get(`/orcamentos/${id}`) : { status: "RASCUNHO", items: [], discountCents: 0 };
    const isEdit = !!id;

    // estado de itens em memória
    let items = (budget.items || []).map((i) => ({
      productServiceId: i.productServiceId || "",
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      unitCostCents: i.unitCostCents,
    }));

    // ----- Cabeçalho -----
    const header = el("form", { class: "form-grid" }, [
      field("Cliente", "clientId", budget.clientId || "", { type: "select", options: [
        { value: "", label: "—" }, ...opts.clients.map((c) => ({ value: c.id, label: c.name })),
      ] }),
      field("Evento", "eventId", budget.eventId || "", { type: "select", options: [
        { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
      ] }),
      field("Validade", "validUntil", budget.validUntil ? String(budget.validUntil).slice(0, 10) : "", { type: "date" }),
      field("Status", "status", budget.status || "RASCUNHO", { type: "select", options:
        Object.entries(BUDGET_STATUS).map(([value, s]) => ({ value, label: s.label })) }),
      field("Desconto (R$)", "discount", centsToReais(budget.discountCents), { placeholder: "0,00" }),
      field("Observações", "notes", budget.notes, { type: "textarea", col2: true }),
    ]);

    // ----- Itens -----
    const itemsBody = el("tbody", {});
    const totalsBox = el("div", { class: "budget-totals" });

    function recalc() {
      const subtotal = items.reduce((a, i) => a + i.quantity * i.unitPriceCents, 0);
      const cost = items.reduce((a, i) => a + i.quantity * i.unitCostCents, 0);
      const discount = toCents(header.querySelector("[name=discount]").value);
      const total = subtotal - discount;
      const margin = total > 0 ? (((total - cost) / total) * 100).toFixed(1) + "%" : "—";
      totalsBox.replaceChildren(
        totalRow("Subtotal", formatBRL(subtotal)),
        totalRow("Desconto", "− " + formatBRL(discount)),
        totalRow("Total", formatBRL(total), true),
        totalRow("Custo estimado", formatBRL(cost)),
        totalRow("Margem", margin, false, "var(--sued-gold-dark)"),
      );
    }
    function totalRow(label, value, strong, color) {
      return el("div", { class: "budget-totals__row" }, [
        el("span", { class: "text-muted" }, label),
        el("span", { style: `${strong ? "font-weight:700;font-size:15px" : ""}${color ? `;color:${color};font-weight:600` : ""}` }, value),
      ]);
    }

    function renderItems() {
      itemsBody.replaceChildren(...items.map((it, idx) => {
        const qty = el("input", { class: "input input--mini", type: "number", min: "1", value: String(it.quantity) });
        qty.oninput = () => { it.quantity = Math.max(1, Number(qty.value) || 1); lineTotal.textContent = formatBRL(it.quantity * it.unitPriceCents); recalc(); };
        const price = el("input", { class: "input input--mini", value: centsToReais(it.unitPriceCents) });
        price.oninput = () => { it.unitPriceCents = toCents(price.value); lineTotal.textContent = formatBRL(it.quantity * it.unitPriceCents); recalc(); };
        const lineTotal = el("span", { style: "font-weight:600" }, formatBRL(it.quantity * it.unitPriceCents));
        const del = el("button", { class: "btn btn--icon btn--ghost", html: icon("trash", 15) });
        del.onclick = () => { items.splice(idx, 1); renderItems(); recalc(); };
        return el("tr", {}, [
          el("td", {}, it.description),
          el("td", { style: "width:70px" }, qty),
          el("td", { style: "width:110px" }, price),
          el("td", { style: "text-align:right" }, lineTotal),
          el("td", { style: "text-align:right;width:44px" }, del),
        ]);
      }));
      if (!items.length) itemsBody.replaceChildren(el("tr", {}, [el("td", { colspan: "5", class: "text-muted", style: "padding:16px;text-align:center" }, "Nenhum item. Adicione do catálogo abaixo.")]));
    }
    renderItems();

    // Adicionar item do catálogo
    const catSel = el("select", { class: "select" }, [
      el("option", { value: "" }, "Selecione um item do catálogo…"),
      ...opts.catalog.map((p) => el("option", { value: p.id }, `${p.name}${p.unit ? " / " + p.unit : ""}`)),
    ]);
    const addCat = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Adicionar item");
    addCat.onclick = () => {
      const p = opts.catalog.find((x) => x.id === catSel.value);
      if (!p) return toast("Selecione um item.", "error");
      items.push({ productServiceId: p.id, description: p.name, quantity: 1, unitPriceCents: p.suggestedPriceCents, unitCostCents: p.referenceCostCents });
      catSel.value = ""; renderItems(); recalc();
    };
    const freeInput = el("input", { class: "input input--mini", placeholder: "Descrição do item avulso", style: "flex:1;min-width:160px" });
    const addFree = el("button", { class: "btn btn--outline btn--sm", type: "button" }, "Adicionar avulso");
    const submitFree = () => {
      const desc = freeInput.value.trim();
      if (!desc) return toast("Informe a descrição do item avulso.", "error");
      items.push({ productServiceId: "", description: desc, quantity: 1, unitPriceCents: 0, unitCostCents: 0 });
      freeInput.value = "";
      renderItems(); recalc();
    };
    addFree.onclick = submitFree;
    freeInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submitFree(); } };

    // Qualquer campo do cabeçalho (não só desconto) precisa recalcular —
    // a pré-visualização abaixo depende de cliente/evento/validade/status/
    // observações também, não só dos totais.
    header.addEventListener("input", recalc);
    header.addEventListener("change", recalc);
    recalc();

    // ----- Pré-visualização (documento com a identidade SUED) -----
    // Reflete o formulário em memória, sem ir ao servidor — "tempo real"
    // de verdade aqui dentro do editor (o link enviado ao cliente, mais
    // abaixo, é near-real-time por polling). Layout provisório, a ajustar
    // quando um modelo de referência da SUED for enviado.
    function previewData() {
      const fd = new FormData(header);
      const clientId = fd.get("clientId");
      const eventId = fd.get("eventId");
      return {
        number: budget.number,
        createdAt: budget.createdAt,
        status: fd.get("status") || "RASCUNHO",
        clientName: opts.clients.find((c) => c.id === clientId)?.name || "",
        eventTitle: opts.events.find((e) => e.id === eventId)?.title || "",
        validUntil: fd.get("validUntil") || null,
        notes: fd.get("notes") || "",
        discountCents: toCents(fd.get("discount")),
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      };
    }
    const previewHost = el("div", {});
    function renderPreview() {
      previewHost.replaceChildren(renderOrcamentoDocumento(previewData()));
    }
    const origRecalc = recalc;
    recalc = () => { origRecalc(); renderPreview(); };
    renderPreview();

    const printBtn = el("button", { class: "btn btn--outline btn--sm", type: "button" }, "Baixar PDF");
    printBtn.onclick = () => {
      // O cabeçalho/rodapé que o navegador imprime por cima da página (data,
      // título, URL, número da página) usa o title da aba — não dá para
      // removê-lo por CSS, só trocar por algo útil enquanto o diálogo de
      // impressão está aberto ("Cabeçalhos e rodapés" é uma opção do
      // próprio navegador, fora do nosso controle).
      const originalTitle = document.title;
      document.title = `Orçamento ${budget.number || "novo"} — SUED`;
      window.addEventListener("afterprint", () => { document.title = originalTitle; }, { once: true });
      window.print();
    };

    const clientLinkRow = el("div", { class: "flex items-center gap-2 no-print", style: "margin-bottom:14px;flex-wrap:wrap" }, [printBtn]);
    if (isEdit) {
      const link = `${window.location.origin}/orcamento/${id}`;
      const copiarLink = el("button", { class: "btn btn--outline btn--sm", type: "button" }, "Copiar link do cliente");
      copiarLink.onclick = async () => {
        try { await navigator.clipboard.writeText(link); toast("Link copiado — envie ao cliente para acompanhar em tempo real."); }
        catch { toast("Não foi possível copiar o link.", "error"); }
      };
      const abrirLink = el("button", { class: "btn btn--outline btn--sm", type: "button" }, "Abrir link");
      abrirLink.onclick = () => window.open(link, "_blank", "noopener");
      clientLinkRow.append(copiarLink, abrirLink);
    } else {
      clientLinkRow.append(el("span", { class: "text-muted", style: "font-size:12.5px" }, "Salve o orçamento para gerar o link do cliente."));
    }

    const tabEditar = el("button", { class: "chip is-active no-print", type: "button" }, "Editar itens");
    const tabPreview = el("button", { class: "chip no-print", type: "button" }, "Pré-visualização");
    const tabs = el("div", { class: "filter-chips" }, [tabEditar, tabPreview]);
    const previewArea = el("div", { style: "display:none" }, [clientLinkRow, previewHost]);
    tabEditar.onclick = () => {
      editArea.style.display = "";
      previewArea.style.display = "none";
      tabEditar.classList.add("is-active");
      tabPreview.classList.remove("is-active");
    };
    tabPreview.onclick = () => {
      renderPreview();
      editArea.style.display = "none";
      previewArea.style.display = "";
      tabPreview.classList.add("is-active");
      tabEditar.classList.remove("is-active");
    };

    // ----- Ações -----
    const voltar = el("button", { class: "btn btn--ghost", html: `${icon("x", 15)}<span>Voltar</span>` });
    voltar.onclick = loadList;
    const salvar = el("button", { class: "btn btn--primary" }, isEdit ? "Salvar orçamento" : "Criar orçamento");
    salvar.onclick = async () => {
      const body = Object.fromEntries(new FormData(header));
      body.items = items;
      salvar.disabled = true;
      try {
        if (isEdit) await api.put(`/orcamentos/${id}`, body);
        else await api.post("/orcamentos", body);
        toast(isEdit ? "Orçamento salvo." : "Orçamento criado.");
        loadList();
      } catch (err) { toast(err.message, "error"); salvar.disabled = false; }
    };
    const actions = [voltar, salvar];
    if (isEdit) {
      const excluir = el("button", { class: "btn btn--danger" }, "Excluir");
      excluir.onclick = async () => {
        if (!confirm(`Excluir o orçamento ${budget.number}?`)) return;
        try { await api.del(`/orcamentos/${id}`); toast("Orçamento excluído."); loadList(); }
        catch (e) { toast(e.message, "error"); }
      };
      actions.unshift(excluir);
    }

    const editArea = el("div", { class: "grid", style: "grid-template-columns:2fr 1fr;align-items:start" }, [
      el("div", { class: "card card--pad" }, [
        el("h2", { style: "font-size:14px;font-weight:600;margin-bottom:12px" }, "Itens"),
        el("table", { class: "budget-items" }, [
          el("thead", {}, [el("tr", {}, [
            el("th", {}, "Descrição"), el("th", {}, "Qtd"), el("th", {}, "Preço un."),
            el("th", { style: "text-align:right" }, "Total"), el("th", {}, ""),
          ])]),
          itemsBody,
        ]),
        el("div", { class: "flex items-center", style: "gap:8px;margin-top:14px;flex-wrap:wrap" }, [catSel, addCat, freeInput, addFree]),
      ]),
      el("div", { class: "card card--pad" }, [
        el("h2", { style: "font-size:14px;font-weight:600;margin-bottom:12px" }, "Resumo"),
        totalsBox,
      ]),
    ]);

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, isEdit ? `Orçamento ${budget.number}` : "Novo orçamento"),
          el("p", {}, "Cliente, itens e condições."),
        ]),
        el("div", { class: "flex items-center gap-2" }, actions),
      ]),
      el("div", { class: "card card--pad", style: "margin-bottom:16px" }, [header]),
      tabs,
      editArea,
      previewArea,
    );
  }

  await loadList();
  return container;
}
