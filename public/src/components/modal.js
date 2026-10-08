// Modal genérico. openModal({ title, body, footer }) → controla abrir/fechar.
import { el } from "../utils.js";
import { icon } from "./icons.js";

// Achado B15 (Fase 5): abrir um modal enquanto outro já está na tela
// empilhava os dois (o de baixo continuava no DOM, escondido atrás do
// backdrop novo, mas ainda "aberto"). Guarda o modal atualmente aberto e
// fecha ele antes de abrir o próximo — nunca mais de um por vez.
let currentModal = null;
let modalSeq = 0;

export function openModal({ title, body, footer, wide = false }) {
  if (currentModal) currentModal.close();

  // Lote 10 (acessibilidade): papel de diálogo, título associado, Esc fecha,
  // o foco entra no modal ao abrir e volta para quem o abriu ao fechar.
  const titleId = `modal-title-${++modalSeq}`;
  const opener = document.activeElement;
  const backdrop = el("div", { class: "modal-backdrop" });
  const closeBtn = el("button", {
    class: "btn btn--icon btn--ghost",
    type: "button",
    "aria-label": "Fechar",
    html: icon("x", 18),
    onclick: close,
  });
  const modal = el("div", {
    class: `modal ${wide ? "modal--wide" : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
  }, [
    el("div", { class: "modal__header" }, [
      el("h2", { class: "font-display", style: "font-size:18px", id: titleId }, title),
      closeBtn,
    ]),
    el("div", { class: "modal__body" }, [body]),
    footer && el("div", { class: "modal__footer" }, footer),
  ]);
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  document.addEventListener("keydown", onKeydown);
  const firstField = modal.querySelector(".modal__body :is(input, select, textarea):not([disabled])");
  (firstField || closeBtn).focus();

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  function close() {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
    if (currentModal === api) currentModal = null;
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  }
  const api = { close };
  currentModal = api;
  return api;
}
