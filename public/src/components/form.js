// Helper de campos de formulário (usado nos modais de todos os módulos).
import { el } from "../utils.js";

export function field(label, name, value = "", opts = {}) {
  const input = opts.type === "select"
    ? el("select", { class: "select", name },
        (opts.options || []).map((o) => {
          const node = el("option", { value: o.value }, o.label);
          if (o.value === value) node.selected = true;
          return node;
        }))
    : opts.type === "textarea"
      ? el("textarea", { class: "textarea", name, placeholder: opts.placeholder || "" }, value || "")
      : el("input", {
          class: "input", name,
          type: opts.type || "text",
          value: value ?? "",
          placeholder: opts.placeholder || "",
        });
  return el("div", { class: `field ${opts.col2 ? "col-2" : ""}` }, [
    el("label", { class: "field__label" }, [label, opts.required && el("span", { class: "req" }, "*")]),
    input,
  ]);
}

// Reexporta o conversor de centavos para inputs (fonte única em utils.js).
export { centsToReais as centsToInput } from "../utils.js";
