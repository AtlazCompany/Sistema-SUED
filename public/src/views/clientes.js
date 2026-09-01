// View de Clientes: lista + criar/editar (modal) + excluir.
import { api } from "../api.js";
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

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

// ---- Contatos do cliente (achado B8, Fase 5) ----
// Mesmo padrão de categoriesModal (public/src/views/catalogo.js): lista +
// remover + adicionar inline, sem tela própria — coerente com o nível de
// simplicidade já usado para cadastros de apoio parecidos neste projeto.
async function contactsModal(client, onChanged) {
  const listBox = el("div", {});

  async function reload() {
    const full = await api.get(`/clientes/${client.id}`);
    const contacts = full.contacts || [];
    listBox.replaceChildren(
      contacts.length
        ? el("ul", { style: "list-style:none" }, contacts.map((c) => {
            const renameBtn = el("button", { class: "btn btn--icon btn--ghost", title: "Renomear", html: icon("edit", 15) });
            renameBtn.onclick = async () => {
              const novo = prompt("Nome do contato:", c.name);
              if (!novo?.trim() || novo.trim() === c.name) return;
              try { await api.put(`/clientes/contatos/${c.id}`, { name: novo.trim(), primary: c.primary }); reload(); }
              catch (err) { toast(err.message, "error"); }
            };
            const delBtn = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 15) });
            delBtn.onclick = async () => {
              if (!confirm(`Excluir o contato "${c.name}"?`)) return;
              try { await api.del(`/clientes/contatos/${c.id}`); reload(); }
              catch (err) { toast(err.message, "error"); }
            };
            const actions = [renameBtn, delBtn];
            if (!c.primary) {
              const makePrimary = el("button", { class: "btn btn--icon btn--ghost", title: "Tornar principal", html: icon("target", 15) });
              makePrimary.onclick = async () => {
                try { await api.put(`/clientes/contatos/${c.id}`, { name: c.name, primary: true }); reload(); }
                catch (err) { toast(err.message, "error"); }
              };
              actions.unshift(makePrimary);
            }
            return el("li", { class: "flex items-center justify-between", style: "padding:8px 0;border-bottom:1px solid var(--sued-border);font-size:13px" }, [
              el("span", {}, [c.primary && el("span", { class: "badge badge--gold", style: "margin-right:8px" }, "Principal"), c.name]),
              el("span", { class: "flex items-center gap-1" }, actions),
            ]);
          }))
        : el("p", { class: "text-muted", style: "font-size:13px" }, "Nenhum contato cadastrado."),
    );
  }
  await reload();

  const nameInput = el("input", { class: "input", placeholder: "Nome do contato" });
  const primaryCb = el("input", { type: "checkbox" });
  const add = el("button", { class: "btn btn--subtle btn--sm", type: "button" }, "Adicionar");
  add.onclick = async () => {
    if (!nameInput.value.trim()) return toast("Informe o nome do contato.", "error");
    add.disabled = true;
    try {
      await api.post(`/clientes/${client.id}/contatos`, { name: nameInput.value, primary: primaryCb.checked });
      nameInput.value = ""; primaryCb.checked = false;
      await reload();
      onChanged();
    } catch (err) { toast(err.message, "error"); }
    add.disabled = false;
  };

  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");
  const modal = openModal({
    title: `Contatos — ${client.name}`,
    body: el("div", {}, [
      listBox,
      el("div", { class: "flex items-center", style: "gap:8px;margin-top:14px;flex-wrap:wrap" }, [
        nameInput,
        el("label", { class: "flex items-center gap-2", style: "font-size:12px;color:var(--sued-ink-soft)" }, [primaryCb, "Principal"]),
        add,
      ]),
    ]),
    footer: [closeBtn],
  });
  closeBtn.onclick = modal.close;
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
          const contacts = el("button", { class: "btn btn--icon btn--ghost", title: "Contatos", html: icon("userPlus", 16) });
          contacts.onclick = () => contactsModal(r, load);
          const edit = el("button", { class: "btn btn--icon btn--ghost", title: "Editar", html: icon("edit", 16) });
          edit.onclick = () => clientForm(r, load);
          const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 16) });
          del.onclick = async () => {
            if (!confirm(`Excluir "${r.name}"?`)) return;
            try { await api.del(`/clientes/${r.id}`); toast("Cliente excluído."); load(); }
            catch (err) { toast(err.message, "error"); }
          };
          return el("div", { class: "flex", style: "justify-content:flex-end;gap:4px" }, [contacts, edit, del]);
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
