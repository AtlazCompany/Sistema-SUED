// View de Locais (venues): lista + cadastro + edição + exclusão.
import { api } from "../api.js";
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

// Achado B12 (Fase 5): antes só dava para criar/listar/excluir — sem
// forma de corrigir um dado já cadastrado. Mesmo padrão de formulário em
// modal já usado em outras telas (ex.: clientForm em clientes.js).
function venueForm(venue, onSaved) {
  const v = venue || {};
  const form = el("form", { class: "form-grid" }, [
    field("Nome", "name", v.name, { required: true, col2: true, placeholder: "Ex.: Espaço SUED" }),
    field("Cidade", "city", v.city),
    field("UF", "state", v.state),
    field("Endereço", "address", v.address, { col2: true }),
    field("Capacidade", "capacity", v.capacity ?? "", { type: "number" }),
    field("Observações", "notes", v.notes, { type: "textarea", col2: true }),
  ]);
  const own = el("label", { class: "flex items-center gap-2", style: "font-size:13px;color:var(--sued-ink-soft)" }, [
    (() => { const cb = el("input", { type: "checkbox", name: "isOwn" }); cb.checked = !!v.isOwn; return cb; })(),
    "Local próprio (Espaço SUED)",
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, "Salvar");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({
    title: "Editar local",
    body: el("div", {}, [form, el("div", { style: "margin-top:12px" }, [own])]),
    footer: [cancel, save],
  });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    body.isOwn = form.parentElement.querySelector("[name=isOwn]").checked;
    if (!body.name?.trim()) return toast("Informe o nome do local.", "error");
    save.disabled = true;
    try {
      await api.put(`/locais/${v.id}`, body);
      modal.close();
      toast("Local atualizado.");
      onSaved();
    } catch (err) { toast(err.message, "error"); save.disabled = false; }
  };
}

export async function renderLocais() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const locais = await api.get("/locais");

    const list = el("div", { class: "card" }, [
      locais.length
        ? el("ul", { style: "list-style:none" }, locais.map((v) => {
            const edit = el("button", { class: "btn btn--icon btn--ghost", title: "Editar", html: icon("edit", 16) });
            edit.onclick = () => venueForm(v, load);
            const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 16) });
            del.onclick = async () => {
              if (!confirm(`Excluir o local "${v.name}"?`)) return;
              try { await api.del(`/locais/${v.id}`); toast("Local excluído."); load(); }
              catch (err) { toast(err.message, "error"); }
            };
            return el("li", { class: "flex items-center justify-between", style: "padding:14px 20px;border-bottom:1px solid var(--sued-border)" }, [
              el("div", { class: "flex items-center gap-3" }, [
                el("span", { class: "user-chip__avatar", style: "width:36px;height:36px", html: icon("mapPin", 16) }),
                el("div", {}, [
                  el("p", { style: "font-weight:500;font-size:14px" }, [
                    v.name,
                    v.isOwn && el("span", { class: "badge badge--gold", style: "margin-left:8px" }, "Espaço próprio"),
                  ]),
                  el("p", { class: "text-muted", style: "font-size:12px" },
                    [v.city && `${v.city}${v.state ? "/" + v.state : ""}`, v.capacity && `${v.capacity} pessoas`].filter(Boolean).join(" · ") || "—"),
                ]),
              ]),
              el("div", { class: "flex items-center gap-3" }, [
                el("span", { class: "text-muted", style: "font-size:12px" }, `${v.events} evento(s)`),
                edit,
                del,
              ]),
            ]);
          }))
        : el("div", { class: "empty", style: "padding:40px;text-align:center" }, [
            el("p", { style: "font-weight:500" }, "Nenhum local cadastrado"),
            el("p", { class: "text-muted", style: "font-size:13px" }, "Cadastre os locais para vinculá-los aos eventos."),
          ]),
    ]);

    // Formulário de novo local
    const form = el("form", { class: "form-grid" }, [
      field("Nome", "name", "", { required: true, col2: true, placeholder: "Ex.: Espaço SUED" }),
      field("Cidade", "city", ""),
      field("UF", "state", ""),
      field("Endereço", "address", "", { col2: true }),
      field("Capacidade", "capacity", "", { type: "number" }),
    ]);
    const own = el("label", { class: "flex items-center gap-2", style: "font-size:13px;color:var(--sued-ink-soft)" }, [
      el("input", { type: "checkbox", name: "isOwn" }),
      "Local próprio (Espaço SUED)",
    ]);
    const add = el("button", { class: "btn btn--primary", type: "button", html: `${icon("plus", 16)}<span>Adicionar local</span>` });
    add.onclick = async () => {
      const body = Object.fromEntries(new FormData(form));
      // O checkbox "isOwn" é irmão do <form> (fora dele), não filho — por
      // isso a busca precisa partir do pai. Bug pré-existente encontrado
      // ao testar a tela na Fase 5 (o clique em "Adicionar local" sempre
      // lançava TypeError antes de chegar no envio).
      body.isOwn = form.parentElement.querySelector("[name=isOwn]").checked;
      if (!body.name?.trim()) return toast("Informe o nome do local.", "error");
      add.disabled = true;
      try { await api.post("/locais", body); toast("Local adicionado."); load(); }
      catch (err) { toast(err.message, "error"); add.disabled = false; }
    };

    const formCard = el("div", { class: "card card--pad" }, [
      el("h2", { style: "font-size:14px;font-weight:600;margin-bottom:14px" }, "Novo local"),
      form, el("div", { style: "margin:12px 0" }, [own]), add,
    ]);

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Locais"),
          el("p", {}, "Espaços onde os eventos acontecem — próprios ou externos."),
        ]),
      ]),
      el("div", { class: "grid", style: "grid-template-columns:2fr 1fr" }, [list, formCard]),
    );
  }

  await load();
  return container;
}
