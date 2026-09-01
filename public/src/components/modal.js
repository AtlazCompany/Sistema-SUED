// Modal genérico. openModal({ title, body, footer }) → controla abrir/fechar.
import { el } from "../utils.js";
import { icon } from "./icons.js";

// Achado B15 (Fase 5): abrir um modal enquanto outro já está na tela
// empilhava os dois (o de baixo continuava no DOM, escondido atrás do
// backdrop novo, mas ainda "aberto"). Guarda o modal atualmente aberto e
// fecha ele antes de abrir o próximo — nunca mais de um por vez.
let currentModal = null;

export function openModal({ title, body, footer, wide = false }) {
  if (currentModal) currentModal.close();

  const backdrop = el("div", { class: "modal-backdrop" });
  const closeBtn = el("button", {
    class: "btn btn--icon btn--ghost",
    html: icon("x", 18),
    onclick: close,
  });
  const modal = el("div", { class: `modal ${wide ? "modal--wide" : ""}` }, [
    el("div", { class: "modal__header" }, [
      el("h2", { class: "font-display", style: "font-size:18px" }, title),
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

  function close() {
    backdrop.remove();
    if (currentModal === api) currentModal = null;
  }
  const api = { close };
  currentModal = api;
  return api;
}
