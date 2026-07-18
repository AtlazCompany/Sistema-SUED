// View de Clientes: lista + criar/editar (modal) + excluir.
import { api } from "../api.js";
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";

function field(label, name, value = "", opts = {}) {
  const input = opts.type === "select"
    ? el("select", { class: "select", name },
        opts.options.map((o) => {
          const node = el("option", { value: o.value }, o.label);
          if (o.value === value) node.selected = true;
          return node;
        }))
    : opts.type === "textarea"
      ? el("textarea", { class: "textarea", name, placeholder: opts.placeholder || "" }, value || "")
      : el("input", { class: "input", name, type: opts.type || "text", value: value ?? "", placeholder: opts.placeholder || "" });
  return el("div", { class: `field ${opts.col2 ? "col-2" : ""}` }, [
    el("label", { class: "field__label" }, [label, opts.required && el("span", { class: "req" }, "*")]),
    input,
  ]);
}

function clientForm(client, onSaved) {
  const isEdit = !!client;
  const c = client || {};
  const form = el("form", { class: "form-grid" }, [
    field("Tipo", "personType", c.personType || "PF", { type: "select", options: [
      { value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" },
    ] }),
    field("Documento (CPF/CNPJ)", "document", c.document),
    field("Nome / Razão social", "name", c.name, { required: true, col2: true }),
    field("Nome fantasia", "tradeName", c.tradeName, { col2: true }),
    field("E-mail", "email", c.email, { type: "email" }),
    field("Telefone", "phone", c.phone),
    field("Cidade", "city", c.city),
    field("UF", "state", c.state),
    field("Observações", "notes", c.notes, { type: "textarea", col2: true }),
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar cliente");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");

  const modal = openModal({
    title: isEdit ? "Editar cliente" : "Novo cliente",
    body: form,
    footer: [cancel, save],
  });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.name?.trim()) return toast("Informe o nome / razão social.", "error");
    save.disabled = true;
    save.textContent = "Salvando…";
    try {
      if (isEdit) await api.put(`/clientes/${c.id}`, body);
      else await api.post("/clientes", body);
      modal.close();
      toast(isEdit ? "Cliente atualizado." : "Cliente criado.");
      onSaved();
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
      save.textContent = isEdit ? "Salvar" : "Criar cliente";
    }
  };
}

export async function renderClientes() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const clients = await api.get("/clientes");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo cliente</span>` });
    novo.onclick = () => clientForm(null, load);

    const table = renderTable({
      columns: [
        { header: "Cliente", render: (r) =>
          el("div", { class: "flex items-center gap-3" }, [
            el("span", { class: "user-chip__avatar", style: "width:32px;height:32px", html: icon(r.personType === "PJ" ? "building" : "users", 16) }),
            el("div", {}, [
              el("span", { class: "link-strong" }, r.name),
              r.tradeName && el("span", { class: "text-muted", style: "display:block;font-size:12px" }, r.tradeName),
            ]),
          ]) },
        { header: "Documento", render: (r) => r.document || "—" },
        { header: "Contato", render: (r) => r.email || r.phone || "—" },
        { header: "Oport.", align: "center", render: (r) => String(r.opportunities) },
        { header: "Eventos", align: "center", render: (r) => String(r.events) },
        { header: "", align: "right", render: (r) => {
          const edit = el("button", { class: "btn btn--icon btn--ghost", title: "Editar", html: icon("edit", 16) });
          edit.onclick = () => clientForm(r, load);
          const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 16) });
          del.onclick = async () => {
            if (!confirm(`Excluir "${r.name}"?`)) return;
            try { await api.del(`/clientes/${r.id}`); toast("Cliente excluído."); load(); }
            catch (err) { toast(err.message, "error"); }
          };
          return el("div", { class: "flex", style: "justify-content:flex-end;gap:4px" }, [edit, del]);
        } },
      ],
      rows: clients,
      empty: { title: "Nenhum cliente cadastrado", desc: "Cadastre o primeiro cliente para começar." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Clientes"),
          el("p", {}, "Cadastro central de clientes — reutilizado em eventos, orçamentos e contratos."),
        ]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
