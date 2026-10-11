// Confirmação no estilo do SUED, no lugar do confirm() do navegador.
//   if (!(await confirmDialog({ title, message, confirmLabel }))) return;
// Responde true só no botão de ação; "Cancelar", Esc e clique fora → false.
// Abre POR CIMA de um modal já aberto (ex.: excluir de dentro do detalhe de
// um fornecedor) sem fechá-lo — por isso não usa openModal(), que fecha o
// modal atual. O foco começa em "Cancelar": um Enter distraído não exclui.
import { el } from "../utils.js";

let seq = 0;

export function confirmDialog({ title = "Confirmar", message = "", confirmLabel = "Excluir", cancelLabel = "Cancelar", danger = true } = {}) {
  return new Promise((resolve) => {
    const titleId = `confirm-title-${++seq}`;
    const messageId = `confirm-message-${seq}`;
    const opener = document.activeElement;

    const cancel = el("button", { class: "btn btn--ghost", type: "button" }, cancelLabel);
    const ok = el("button", { class: `btn ${danger ? "btn--danger" : "btn--primary"}`, type: "button" }, confirmLabel);
    const backdrop = el("div", { class: "modal-backdrop modal-backdrop--confirm" }, [
      el("div", {
        class: "modal modal--confirm",
        role: "alertdialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": messageId,
      }, [
        el("div", { class: "modal__body" }, [
          el("h2", { class: "font-display confirm__title", id: titleId }, title),
          el("p", { class: "confirm__message", id: messageId }, message),
        ]),
        el("div", { class: "modal__footer" }, [cancel, ok]),
      ]),
    ]);

    function done(answer) {
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
      resolve(answer);
    }

    // Na fase de captura: o Esc daqui não chega ao modal de baixo (que
    // fecharia junto), e o Tab circula só entre os dois botões.
    function onKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        done(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    }

    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(false); });
    document.addEventListener("keydown", onKeydown, true);
    document.body.append(backdrop);
    cancel.focus();
  });
}
