// Tabela reutilizável. renderTable({ columns, rows, empty }) → nó DOM.
import { el } from "../utils.js";

/**
 * columns: [{ header, render(row) -> node|string, align }]
 * rows: array de objetos
 * empty: { title, desc } estado vazio
 */
export function renderTable({ columns, rows, empty }) {
  if (!rows.length) {
    return el("div", { class: "empty" }, [
      el("p", { class: "empty__title" }, empty?.title || "Nada por aqui"),
      empty?.desc && el("p", { class: "empty__desc" }, empty.desc),
    ]);
  }

  const thead = el("thead", {}, [
    el(
      "tr",
      {},
      columns.map((c) =>
        el("th", { style: c.align ? `text-align:${c.align}` : "" }, c.header),
      ),
    ),
  ]);

  const tbody = el(
    "tbody",
    {},
    rows.map((row) =>
      el(
        "tr",
        {},
        columns.map((c) => {
          const content = c.render(row);
          return el(
            "td",
            { style: c.align ? `text-align:${c.align}` : "" },
            content?.nodeType ? content : String(content ?? "—"),
          );
        }),
      ),
    ),
  );

  return el("div", { class: "table-wrap" }, [el("table", { class: "table" }, [thead, tbody])]);
}
