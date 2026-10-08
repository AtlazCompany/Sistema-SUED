// View de Fornecedores: lista + criar/editar (modal) + detalhe com itens.
import { api } from "../api.js";
import { el, formatBRL } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

function supplierForm(supplier, onSaved) {
  const isEdit = !!supplier;
  const s = supplier || {};
  const form = el("form", { class: "form-grid" }, [
    field("Nome", "name", s.name, { required: true, col2: true }),
    field("Categoria", "category", s.category, { placeholder: "buffet, decoração, som…" }),
    field("Documento (CPF/CNPJ)", "document", s.document),
    field("E-mail", "email", s.email, { type: "email" }),
    field("Telefone", "phone", s.phone),
    field("Observações", "notes", s.notes, { type: "textarea", col2: true }),
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar fornecedor");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isEdit ? "Editar fornecedor" : "Novo fornecedor", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.name?.trim()) return toast("Informe o nome do fornecedor.", "error");
    save.disabled = true;
    try {
      if (isEdit) await api.put(`/fornecedores/${s.id}`, body);
      else await api.post("/fornecedores", body);
      modal.close();
      toast(isEdit ? "Fornecedor atualizado." : "Fornecedor criado.");
      onSaved();
    } catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

async function supplierDetail(id, onChanged) {
  const s = await api.get(`/fornecedores/${id}`);
  const editBtn = el("button", { class: "btn btn--outline", type: "button", html: `${icon("edit", 15)}<span>Editar</span>` });
  const delBtn = el("button", { class: "btn btn--danger", type: "button", html: `${icon("trash", 15)}<span>Excluir</span>` });
  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");

  const row = (label, value) => el("div", { class: "opp-summary__row" }, [
    el("span", { class: "text-muted" }, label), el("span", {}, value || "—"),
  ]);

  const body = el("div", {}, [
    el("div", { class: "opp-summary" }, [
      row("Categoria", s.category),
      row("Documento", s.document),
      row("E-mail", s.email),
      row("Telefone", s.phone),
    ]),
    s.notes && el("p", { class: "text-soft", style: "margin-top:10px;font-size:13px;white-space:pre-wrap" }, s.notes),
    el("hr", { class: "sued-divider-gold my-4" }),
    el("h3", { class: "subsection-title" }, "Itens fornecidos"),
    s.products.length
      ? el("ul", { class: "list-none" }, s.products.map((p) =>
          el("li", { class: "flex items-center justify-between list-row" }, [
            el("span", {}, [
              p.isDefault && el("span", { class: "badge badge--gold mr-2" }, "Padrão"),
              p.name, p.unit && el("span", { class: "text-muted" }, ` / ${p.unit}`),
            ]),
            el("span", { class: "text-soft" }, formatBRL(p.costCents)),
          ])))
      : el("p", { class: "text-muted text-sm" }, "Nenhum item vinculado. Vincule na tela do Catálogo."),
  ]);

  const modal = openModal({ title: s.name, body, footer: [delBtn, closeBtn, editBtn], wide: true });
  closeBtn.onclick = modal.close;
  editBtn.onclick = () => { modal.close(); supplierForm(s, onChanged); };
  delBtn.onclick = async () => {
    if (!confirm(`Excluir o fornecedor "${s.name}"?`)) return;
    try { await api.del(`/fornecedores/${s.id}`); modal.close(); toast("Fornecedor excluído."); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };
}

export async function renderFornecedores() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen loading-box" }, [el("div", { class: "spinner" })]));
    const suppliers = await api.get("/fornecedores");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo fornecedor</span>` });
    novo.onclick = () => supplierForm(null, load);

    const table = renderTable({
      columns: [
        { header: "Fornecedor", render: (r) => {
          const link = el("span", { class: "link-strong cursor-pointer" }, r.name);
          link.onclick = () => supplierDetail(r.id, load);
          return link;
        } },
        { header: "Categoria", render: (r) => r.category || "—" },
        { header: "Contato", render: (r) => r.email || r.phone || "—" },
        { header: "Itens", align: "center", render: (r) => String(r.products) },
      ],
      rows: suppliers,
      empty: { title: "Nenhum fornecedor cadastrado", desc: "Cadastre fornecedores para vinculá-los aos itens do catálogo." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Fornecedores"),
          el("p", {}, "Parceiros que fornecem produtos e serviços para os eventos."),
        ]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
