// Casca da aplicação: sidebar (RBAC) + header. Retorna a área de conteúdo.
import { el, initials } from "../utils.js";
import { icon } from "./icons.js";
import { NAV_ITEMS, ROLE_LABELS, canAccess, APP_NAME } from "../config.js";
import { logout, changePassword } from "../auth.js";
import { goldBranches } from "./decor.js";
import { openModal } from "./modal.js";
import { field } from "./form.js";
import { toast } from "./toast.js";

function openChangePasswordModal() {
  const current = field("Senha atual", "currentPassword", "", { type: "password", required: true, col2: true });
  const novaSenha = field("Nova senha", "newPassword", "", { type: "password", required: true, placeholder: "mínimo 8 caracteres", col2: true });
  const confirmar = field("Confirmar nova senha", "confirmNewPassword", "", { type: "password", required: true, placeholder: "repita a nova senha", col2: true });
  const form = el("form", { class: "form-grid" }, [current, novaSenha, confirmar]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, "Alterar senha");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: "Alterar minha senha", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.currentPassword) return toast("Informe a senha atual.", "error");
    if (!body.newPassword || body.newPassword.length < 8) return toast("A nova senha deve ter pelo menos 8 caracteres.", "error");
    if (body.newPassword !== body.confirmNewPassword) return toast("A confirmação da senha não confere.", "error");
    save.disabled = true;
    save.textContent = "Alterando…";
    try {
      await changePassword(body.currentPassword, body.newPassword, body.confirmNewPassword);
      modal.close();
      toast("Senha alterada.");
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
      save.textContent = "Alterar senha";
    }
  };
}

export function renderShell(user, onLogout) {
  const items = NAV_ITEMS.filter((i) => canAccess(user.role, i.module));

  const nav = el(
    "nav",
    { class: "sidebar__nav" },
    items.map((item) =>
      el("a", {
        class: "nav-item",
        href: item.path,
        "data-link": "",
        "data-path": item.path,
        html: `${icon(item.icon, 18)}<span>${item.label}</span>`,
      }),
    ),
  );
  // Fecha o menu mobile ao navegar para outra tela.
  nav.addEventListener("click", (e) => {
    if (e.target.closest(".nav-item")) sidebar.classList.remove("is-open");
  });

  const sidebar = el("aside", { class: "sidebar", id: "sidebar" }, [
    el("div", { class: "sidebar__brand" }, [
      el("span", {
        class: "font-display sued-gold-text",
        style: "font-size:20px;letter-spacing:.3em;font-weight:600;padding-left:.3em",
      }, "SUED"),
    ]),
    nav,
    el("div", { class: "sidebar__footer" }, [
      el("hr", { class: "sued-divider-gold", style: "margin-bottom:12px" }),
      el("p", { class: "text-muted", style: "font-size:11px;letter-spacing:.2em;text-transform:uppercase" }, `${APP_NAME} · v2`),
    ]),
  ]);

  const changePasswordBtn = el("button", {
    class: "btn btn--icon btn--ghost",
    title: "Alterar minha senha",
    html: icon("lock", 18),
    onclick: openChangePasswordModal,
  });

  const logoutBtn = el("button", {
    class: "btn btn--icon btn--ghost",
    title: "Sair",
    html: icon("logout", 18),
    onclick: async () => {
      await logout();
      onLogout();
    },
  });

  const menuBtn = el("button", {
    class: "btn btn--icon btn--ghost menu-toggle",
    "aria-label": "Abrir menu",
    html: icon("menu"),
    onclick: () => sidebar.classList.toggle("is-open"),
  });

  // Sobreposição atrás do menu mobile — toca fora para fechar.
  const sidebarBackdrop = el("div", {
    class: "sidebar-backdrop",
    onclick: () => sidebar.classList.remove("is-open"),
  });

  const header = el("header", { class: "app-header" }, [
    menuBtn,
    el("div", { class: "user-chip" }, [
      el("div", { style: "text-align:right" }, [
        el("p", { style: "font-weight:500;line-height:1.2" }, user.name),
        el("p", { class: "text-muted", style: "font-size:12px;line-height:1.2" }, ROLE_LABELS[user.role] || user.role),
      ]),
      el("div", { class: "user-chip__avatar" }, initials(user.name)),
      changePasswordBtn,
      logoutBtn,
    ]),
  ]);

  const content = el("main", { class: "app-content", id: "app-content" });
  // Camada decorativa sutil (rachaduras douradas SUED) atrás do conteúdo.
  const decor = el("div", { class: "app-decor", html: goldBranches() });
  const main = el("div", { class: "app-main" }, [decor, header, content]);
  const root = el("div", { class: "app-shell" }, [sidebar, sidebarBackdrop, main]);

  return { root, content };
}

// Marca o item de menu ativo conforme o caminho da rota atual.
export function setActiveNav(path) {
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("is-active", n.dataset.path === path),
  );
}
