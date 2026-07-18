// Casca da aplicação: sidebar (RBAC) + header. Retorna a área de conteúdo.
import { el, initials } from "../utils.js";
import { icon } from "./icons.js";
import { NAV_ITEMS, ROLE_LABELS, canAccess, APP_NAME } from "../config.js";
import { logout } from "../auth.js";
import { goldCracks } from "./decor.js";

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
        "data-module": item.module,
        html: `${icon(item.icon, 18)}<span>${item.label}</span>`,
      }),
    ),
  );

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
    class: "btn btn--icon btn--ghost",
    style: "display:none",
    html: icon("menu"),
    onclick: () => sidebar.classList.toggle("is-open"),
  });

  const header = el("header", { class: "app-header" }, [
    menuBtn,
    el("div", { class: "user-chip" }, [
      el("div", { style: "text-align:right" }, [
        el("p", { style: "font-weight:500;line-height:1.2" }, user.name),
        el("p", { class: "text-muted", style: "font-size:12px;line-height:1.2" }, ROLE_LABELS[user.role] || user.role),
      ]),
      el("div", { class: "user-chip__avatar" }, initials(user.name)),
      logoutBtn,
    ]),
  ]);

  const content = el("main", { class: "app-content", id: "app-content" });
  // Camada decorativa sutil (rachaduras douradas SUED) atrás do conteúdo.
  const decor = el("div", { class: "app-decor", html: goldCracks() });
  const main = el("div", { class: "app-main" }, [decor, header, content]);
  const root = el("div", { class: "app-shell" }, [sidebar, main]);

  return { root, content };
}

// Marca o item de menu ativo conforme o módulo da rota atual.
export function setActiveNav(module) {
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("is-active", n.dataset.module === module),
  );
}
