// Modal genérico. openModal({ title, body, footer }) → controla abrir/fechar.
import { el } from "../utils.js";
import { icon } from "./icons.js";

export function openModal({ title, body, footer }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const closeBtn = el("button", {
    class: "btn btn--icon btn--ghost",
    html: icon("x", 18),
    onclick: close,
  });
  const modal = el("div", { class: "modal" }, [
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
  }
  return { close };
}
