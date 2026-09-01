// Utilitários reutilizáveis do frontend.

/** Cria um elemento DOM com atributos e filhos. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Escapa HTML para inserção segura via innerHTML. */
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/** Centavos (int) → "R$ 1.234,56". */
export function formatBRL(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    (Number(cents) || 0) / 100,
  );
}

/** "12.500,00" (reais) → 1250000 (centavos). */
export function toCents(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const n =
    typeof value === "string"
      ? Number(value.replace(/\./g, "").replace(",", "."))
      : value;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos → "1234,56" (para inputs em reais). */
export function centsToReais(cents) {
  return cents ? ((Number(cents) || 0) / 100).toFixed(2).replace(".", ",") : "";
}

/** Data (ISO/Date) → "15 de nov. de 2026" (em UTC, para datas só-dia).
 *  Com withTime=true, formata como timestamp local: "15 de nov., 14:32". */
export function formatDate(date, withTime = false) {
  if (!date) return "—";
  if (withTime) {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(date));
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(date));
}

/** Iniciais de um nome (avatar). */
export function initials(name = "") {
  return name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}
