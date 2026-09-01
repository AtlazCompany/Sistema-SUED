// View de Usuários: lista + criar/editar (modal) + redefinir senha + excluir.
// Só ADMIN/SOCIO alcançam esta tela (módulo "usuarios" em roles.js).
import { api } from "../api.js";
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";
import { ROLE_LABELS } from "../config.js";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

function userForm(user, onSaved) {
  const isEdit = !!user;
  const u = user || {};
  const form = el("form", { class: "form-grid" }, [
    field("Nome", "name", u.name, { required: true, col2: true }),
    field("E-mail", "email", u.email, { type: "email", required: true, col2: true }),
    field("Papel", "role", u.role || "COMERCIAL", { type: "select", options: ROLE_OPTIONS }),
    !isEdit && field("Senha inicial", "password", "", { type: "password", required: true, placeholder: "mínimo 8 caracteres", col2: true }),
  ]);
  const active = isEdit
    ? el("label", { class: "flex items-center gap-2", style: "font-size:13px;color:var(--sued-ink-soft)" }, [
        (() => { const cb = el("input", { type: "checkbox", name: "active" }); cb.checked = u.active !== false; return cb; })(),
        "Usuário ativo (consegue fazer login)",
      ])
    : null;

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar usuário");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({
    title: isEdit ? "Editar usuário" : "Novo usuário",
    body: el("div", {}, [form, active && el("div", { style: "margin-top:12px" }, [active])]),
    footer: [cancel, save],
  });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.name?.trim()) return toast("Informe o nome.", "error");
    if (!body.email?.trim()) return toast("Informe o e-mail.", "error");
    if (isEdit) body.active = form.parentElement.querySelector("[name=active]").checked;
    save.disabled = true;
    save.textContent = "Salvando…";
    try {
      if (isEdit) await api.put(`/usuarios/${u.id}`, body);
      else await api.post("/usuarios", body);
      modal.close();
      toast(isEdit ? "Usuário atualizado." : "Usuário criado.");
      onSaved();
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
      save.textContent = isEdit ? "Salvar" : "Criar usuário";
    }
  };
}

function resetPasswordModal(user) {
  const input = el("input", { class: "input", type: "password", placeholder: "Nova senha (mínimo 8 caracteres)" });
  const save = el("button", { class: "btn btn--primary", type: "button" }, "Redefinir");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({
    title: `Redefinir senha — ${user.name}`,
    body: el("div", { class: "field" }, [input]),
    footer: [cancel, save],
  });
  cancel.onclick = modal.close;
  save.onclick = async () => {
    if (!input.value || input.value.length < 8) return toast("A senha deve ter pelo menos 8 caracteres.", "error");
    save.disabled = true;
    try {
      await api.post(`/usuarios/${user.id}/redefinir-senha`, { password: input.value });
      modal.close();
      toast("Senha redefinida.");
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
    }
  };
}

export async function renderUsuarios() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const users = await api.get("/usuarios");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo usuário</span>` });
    novo.onclick = () => userForm(null, load);

    const table = renderTable({
      columns: [
        { header: "Nome", render: (r) => el("span", { class: "link-strong" }, r.name) },
        { header: "E-mail", render: (r) => r.email },
        { header: "Papel", render: (r) => ROLE_LABELS[r.role] || r.role },
        { header: "Status", align: "center", render: (r) =>
          el("span", { class: `badge ${r.active ? "badge--success" : "badge--muted"}` }, r.active ? "Ativo" : "Inativo") },
        { header: "", align: "right", render: (r) => {
          const edit = el("button", { class: "btn btn--icon btn--ghost", title: "Editar", html: icon("edit", 16) });
          edit.onclick = () => userForm(r, load);
          const key = el("button", { class: "btn btn--icon btn--ghost", title: "Redefinir senha", html: icon("lock", 16) });
          key.onclick = () => resetPasswordModal(r);
          const del = el("button", { class: "btn btn--icon btn--ghost", title: "Excluir", html: icon("trash", 16) });
          del.onclick = async () => {
            if (!confirm(`Excluir o usuário "${r.name}"?`)) return;
            try { await api.del(`/usuarios/${r.id}`); toast("Usuário excluído."); load(); }
            catch (err) { toast(err.message, "error"); }
          };
          return el("div", { class: "flex", style: "justify-content:flex-end;gap:4px" }, [edit, key, del]);
        } },
      ],
      rows: users,
      empty: { title: "Nenhum usuário cadastrado", desc: "Crie o primeiro usuário adicional da equipe." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Usuários"),
          el("p", {}, "Contas de acesso ao sistema — papéis, ativação e senha."),
        ]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  await load();
  return container;
}
