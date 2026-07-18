// View temporária para módulos ainda não migrados.
import { el } from "../utils.js";

export function renderPlaceholder(title, phase) {
  return el("div", {}, [
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, title)]),
    ]),
    el("div", { class: "card empty" }, [
      el("p", { class: "empty__title" }, "Em construção"),
      el("p", { class: "empty__desc" }, `Este módulo será migrado na Fase ${phase} da nova base. O backend e a estrutura já estão prontos para recebê-lo.`),
    ]),
  ]);
}
