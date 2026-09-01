// View do Catálogo: produtos/serviços + categorias + vínculo com fornecedores.
import { api } from "../api.js";
import { el, formatBRL, centsToReais } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

// ---------- Formulário do item ----------
async function productForm(product, onSaved) {
  const isEdit = !!product;
  const p = product || {};
  const categories = await api.get("/catalogo/categorias");

  const form = el("form", { class: "form-grid" }, [
    field("Nome", "name", p.name, { required: true, col2: true, placeholder: "Ex.: Buffet completo" }),
    field("Descrição", "description", p.description, { type: "textarea", col2: true }),
    field("Categoria", "categoryId", p.categoryId || "", { type: "select", options: [
      { value: "", label: "—" },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ] }),
    field("Unidade", "unit", p.unit, { placeholder: "un, hora, diária, pessoa…" }),
    field("Custo de referência (R$)", "referenceCost", centsToReais(p.referenceCostCents), { placeholder: "0,00" }),
    field("Preço de venda sugerido (R$)", "suggestedPrice", centsToReais(p.suggestedPriceCents), { placeholder: "0,00" }),
  ]);
  const active = el("label", { class: "flex items-center gap-2", style: "font-size:13px;color:var(--sued-ink-soft)" }, [
    (() => { const cb = el("input", { type: "checkbox", name: "active" }); cb.checked = isEdit ? p.active : true; return cb; })(),
    "Item ativo (disponível para orçamentos)",
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar item");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isEdit ? "Editar item" : "Novo item", body: el("div", {}, [form, el("div", { style: "margin-top:12px" }, [active])]), footer: [cancel, save] });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    body.active = form.parentElement.querySelector("[name=active]").checked;
    if (!body.name?.trim()) return toast("Informe o nome do item.", "error");
    save.disabled = true;
    try {
      if (isEdit) await api.put(`/catalogo/${p.id}`, body);
      else await api.post("/catalogo", body);
      modal.close();
      toast(isEdit ? "Item atualizado." : "Item criado.");
      onSaved();
    } catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

// ---------- Detalhe do item (valores + fornecedores) ----------
async function productDetail(id, onChanged) {
  const [p, suppliers] = await Promise.all([api.get(`/catalogo/${id}`), api.get("/fornecedores")]);
  const margin = p.suggestedPriceCents > 0
    ? (((p.suggestedPriceCents - p.referenceCostCents) / p.suggestedPriceCents) * 100).toFixed(1) + "%" : "—";

  const linksBox = el("div", {});
  function renderLinks(links) {
    linksBox.replaceChildren(
      links.length
        ? el("ul", { style: "list-style:none" }, links.map((l) =>
            el("li", { class: "flex items-center justify-between", style: "padding:8px 0;border-bottom:1px solid var(--sued-border);font-size:13px" }, [
              el("span", {}, [l.isDefault && el("span", { class: "badge badge--gold", style: "margin-right:8px" }, "Padrão"), l.name]),
              (() => {
                const del = el("button", { class: "btn btn--icon btn--ghost", title: "Remover", html: icon("trash", 15) });
                del.onclick = async () => {
                  try { await api.del(`/catalogo/fornecedores/${l.id}`); const u = await api.get(`/catalogo/${id}`); renderLinks(u.suppliers); }
                  catch (err) { toast(err.message, "error"); }
                };
                return el("span", { class: "flex items-center gap-3" }, [el("span", { class: "text-soft" }, formatBRL(l.costCents)), del]);
              })(),
            ])))
        : el("p", { class: "text-muted", style: "font-size:13px" }, "Nenhum fornecedor vinculado."),
    );
  }
  renderLinks(p.suppliers);

  // Form de vínculo
  const supSel = el("select", { class: "select" }, [
    el("option", { value: "" }, "Selecione um fornecedor…"),
    ...suppliers.map((s) => el("option", { value: s.id }, s.name)),
  ]);
  const costInput = el("input", { class: "input", placeholder: "Custo R$", style: "max-width:120px" });
  const defCb = el("input", { type: "checkbox" });
  const addBtn = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Vincular");
  addBtn.onclick = async () => {
    if (!supSel.value) return toast("Selecione um fornecedor.", "error");
    addBtn.disabled = true;
    try {
      await api.post(`/catalogo/${id}/fornecedores`, { supplierId: supSel.value, cost: costInput.value, isDefault: defCb.checked });
      const u = await api.get(`/catalogo/${id}`);
      renderLinks(u.suppliers);
      supSel.value = ""; costInput.value = ""; defCb.checked = false;
    } catch (err) { toast(err.message, "error"); }
    addBtn.disabled = false;
  };

  const row = (label, value, strong = false) => el("div", { class: "opp-summary__row" }, [
    el("span", { class: "text-muted" }, label),
    el("span", { style: strong ? "font-weight:600" : "" }, value),
  ]);

  const editBtn = el("button", { class: "btn btn--outline", type: "button", html: `${icon("edit", 15)}<span>Editar</span>` });
  const delBtn = el("button", { class: "btn btn--danger", type: "button", html: `${icon("trash", 15)}<span>Excluir</span>` });
  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");

  const body = el("div", {}, [
    p.description && el("p", { class: "text-soft", style: "font-size:13px;margin-bottom:12px;white-space:pre-wrap" }, p.description),
    el("div", { class: "opp-summary" }, [
      row("Categoria", p.categoryName || "—"),
      row("Unidade", p.unit || "—"),
      row("Custo de referência", formatBRL(p.referenceCostCents)),
      row("Preço sugerido", formatBRL(p.suggestedPriceCents), true),
      row("Margem sugerida", margin),
      row("Status", p.active ? "Ativo" : "Inativo"),
    ]),
    el("hr", { class: "sued-divider-gold", style: "margin:16px 0" }),
    el("h3", { style: "font-size:13px;font-weight:600;margin-bottom:10px" }, "Fornecedores deste item"),
    linksBox,
    el("div", { class: "flex items-center", style: "gap:8px;margin-top:12px;flex-wrap:wrap" }, [
      supSel, costInput,
      el("label", { class: "flex items-center gap-2", style: "font-size:12px;color:var(--sued-ink-soft)" }, [defCb, "Padrão"]),
      addBtn,
    ]),
  ]);

  const modal = openModal({ title: p.name, body, footer: [delBtn, closeBtn, editBtn], wide: true });
  closeBtn.onclick = modal.close;
  editBtn.onclick = () => { modal.close(); productForm(p, onChanged); };
  delBtn.onclick = async () => {
    if (!confirm(`Excluir "${p.name}" do catálogo?`)) return;
    try { await api.del(`/catalogo/${p.id}`); modal.close(); toast("Item excluído."); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---------- Gestão de categorias ----------
async function categoriesModal(onChanged) {
  const listBox = el("div", {});
  async function reload() {
    const cats = await api.get("/catalogo/categorias");
    listBox.replaceChildren(
      cats.length
        ? el("ul", { style: "list-style:none" }, cats.map((c) => {
            const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 15) });
            del.onclick = async () => {
              if (!confirm(`Excluir a categoria "${c.name}"?`)) return;
              try { await api.del(`/catalogo/categorias/${c.id}`); reload(); onChanged(); }
              catch (err) { toast(err.message, "error"); }
            };
            return el("li", { class: "flex items-center justify-between", style: "padding:8px 0;border-bottom:1px solid var(--sued-border);font-size:13px" }, [
              el("span", {}, c.name),
              el("span", { class: "flex items-center gap-3" }, [el("span", { class: "text-muted" }, `${c.products} item(s)`), del]),
            ]);
          }))
        : el("p", { class: "text-muted", style: "font-size:13px" }, "Nenhuma categoria."),
    );
  }
  await reload();

  const input = el("input", { class: "input", placeholder: "Nova categoria" });
  const add = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Adicionar");
  add.onclick = async () => {
    if (!input.value.trim()) return;
    try { await api.post("/catalogo/categorias", { name: input.value }); input.value = ""; reload(); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };

  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");
  const modal = openModal({
    title: "Categorias",
    body: el("div", {}, [listBox, el("div", { class: "flex items-center", style: "gap:8px;margin-top:14px" }, [input, add])]),
    footer: [closeBtn],
  });
  closeBtn.onclick = modal.close;
}

// ---------- Lista ----------
export async function renderCatalogo() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const items = await api.get("/catalogo");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo item</span>` });
    novo.onclick = () => productForm(null, load);
    const catBtn = el("button", { class: "btn btn--outline" }, "Categorias");
    catBtn.onclick = () => categoriesModal(load);

    const table = renderTable({
      columns: [
        { header: "Item", render: (r) => {
          const link = el("span", { class: "link-strong", style: "cursor:pointer" }, r.name);
          link.onclick = () => productDetail(r.id, load);
          return el("span", {}, [link, r.unit && el("span", { class: "text-muted" }, ` / ${r.unit}`)]);
        } },
        { header: "Categoria", render: (r) => r.categoryName || "—" },
        { header: "Custo ref.", align: "right", render: (r) => formatBRL(r.referenceCostCents) },
        { header: "Preço sugerido", align: "right", render: (r) => el("span", { style: "font-weight:600" }, formatBRL(r.suggestedPriceCents)) },
        { header: "Forn.", align: "center", render: (r) => String(r.suppliers) },
        { header: "Status", align: "center", render: (r) =>
          el("span", { class: `badge ${r.active ? "badge--success" : "badge--muted"}` }, r.active ? "Ativo" : "Inativo") },
      ],
      rows: items,
      empty: { title: "Catálogo vazio", desc: "Cadastre produtos e serviços para agilizar a montagem de orçamentos." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Catálogo"),
          el("p", {}, "Produtos e serviços reutilizáveis — com custo de referência e preço sugerido."),
        ]),
        el("div", { class: "flex items-center gap-2" }, [catBtn, novo]),
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
