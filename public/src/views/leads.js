// View de Leads: lista + criar/editar (modal) + converter em cliente.
import { api } from "../api.js";
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";
import { router } from "../router.js";

export const LEAD_STATUS = {
  NOVO: { label: "Novo", cls: "badge--info" },
  EM_CONTATO: { label: "Em contato", cls: "badge--gold" },
  QUALIFICADO: { label: "Qualificado", cls: "badge--gold" },
  CONVERTIDO: { label: "Convertido", cls: "badge--success" },
  PERDIDO: { label: "Perdido", cls: "badge--danger" },
};

function leadForm(lead, onSaved) {
  const isEdit = !!lead;
  const l = lead || {};
  const form = el("form", { class: "form-grid" }, [
    field("Nome", "name", l.name, { required: true, col2: true }),
    field("Empresa", "company", l.company, { col2: true }),
    field("E-mail", "email", l.email, { type: "email" }),
    field("Telefone", "phone", l.phone),
    field("Origem", "source", l.source, { placeholder: "indicação, Instagram, site…" }),
    field("Status", "status", l.status || "NOVO", {
      type: "select",
      options: Object.entries(LEAD_STATUS).map(([value, s]) => ({ value, label: s.label })),
    }),
    field("Observações", "notes", l.notes, { type: "textarea", col2: true }),
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar lead");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isEdit ? "Editar lead" : "Novo lead", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.name?.trim()) return toast("Informe o nome do lead.", "error");
    save.disabled = true;
    try {
      if (isEdit) await api.put(`/leads/${l.id}`, body);
      else await api.post("/leads", body);
      modal.close();
      toast(isEdit ? "Lead atualizado." : "Lead criado.");
      onSaved();
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
    }
  };
}

export async function renderLeads() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const leads = await api.get("/leads");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo lead</span>` });
    novo.onclick = () => leadForm(null, load);

    const table = renderTable({
      columns: [
        { header: "Nome", render: (r) =>
          el("div", {}, [
            el("span", { class: "link-strong" }, r.name),
            r.company && el("span", { class: "text-muted", style: "display:block;font-size:12px" }, r.company),
          ]) },
        { header: "Contato", render: (r) => r.email || r.phone || "—" },
        { header: "Origem", render: (r) => r.source || "—" },
        { header: "Status", render: (r) => {
          const s = LEAD_STATUS[r.status] || { label: r.status, cls: "" };
          return el("span", { class: `badge ${s.cls}` }, s.label);
        } },
        { header: "", align: "right", render: (r) => {
          const actions = [];
          if (r.status !== "CONVERTIDO") {
            const conv = el("button", { class: "btn btn--subtle btn--sm", title: "Converter em cliente" }, "Converter");
            conv.onclick = async () => {
              if (!confirm(`Converter "${r.name}" em cliente?`)) return;
              try {
                await api.post(`/leads/${r.id}/converter`);
                toast("Lead convertido em cliente.");
                router.navigate("/clientes");
              } catch (err) { toast(err.message, "error"); }
            };
            actions.push(conv);
          }
          const edit = el("button", { class: "btn btn--icon btn--ghost", title: "Editar", html: icon("edit", 16) });
          edit.onclick = () => leadForm(r, load);
          const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 16) });
          del.onclick = async () => {
            if (!confirm(`Excluir o lead "${r.name}"?`)) return;
            try { await api.del(`/leads/${r.id}`); toast("Lead excluído."); load(); }
            catch (err) { toast(err.message, "error"); }
          };
          return el("div", { class: "flex items-center", style: "justify-content:flex-end;gap:4px" }, [...actions, edit, del]);
        } },
      ],
      rows: leads,
      empty: { title: "Nenhum lead cadastrado", desc: "Cadastre leads e acompanhe a prospecção até virar cliente." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Leads"),
          el("p", {}, "Contatos em prospecção — converta em cliente quando qualificado."),
        ]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
