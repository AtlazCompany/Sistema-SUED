// Documento de orçamento com a identidade visual da SUED — reutilizado em
// três lugares: a aba "Pré-visualização" do editor (views/orcamentos.js),
// o link público enviado ao cliente (views/orcamento-publico.js) e o modal
// "Ver orçamento" em Contratos (views/contratos.js). Um único lugar garante
// que os três fiquem sempre visualmente idênticos.
//
// Por design, esta função NUNCA olha para custo/margem (unitCostCents,
// costTotal) mesmo que estejam presentes no objeto recebido — só os campos
// que já apareceriam numa proposta comercial enviada ao cliente.
import { el, formatBRL, formatDate } from "../utils.js";
import { suedMonogram } from "./sued-monogram.js";

const STATUS_LABELS = {
  RASCUNHO: "Em elaboração",
  ENVIADO: "Aguardando retorno",
  APROVADO: "Aprovado",
  REJEITADO: "Não aprovado",
  EXPIRADO: "Expirado",
};

function metaCol(label, value) {
  return el("div", { class: "doc-orcamento__metacol" }, [el("span", {}, label), el("strong", {}, value)]);
}

function totalLine(label, value, strong) {
  return el("div", { class: `doc-orcamento__totalline${strong ? " doc-orcamento__totalline--strong" : ""}` }, [
    el("span", {}, label),
    el("span", {}, value),
  ]);
}

export function renderOrcamentoDocumento(data) {
  const items = data.items || [];
  const subtotal = items.reduce((a, i) => a + Number(i.quantity) * Number(i.unitPriceCents), 0);
  const discount = Number(data.discountCents) || 0;
  const total = subtotal - discount;
  const statusLabel = STATUS_LABELS[data.status] || data.status || "Em elaboração";

  return el("article", { class: "doc-orcamento" }, [
    el("header", { class: "doc-orcamento__head" }, [
      el("div", { class: "doc-orcamento__brand" }, [
        el("span", { class: "doc-orcamento__mono", html: suedMonogram(40) }),
        el("div", {}, [
          el("p", { class: "doc-orcamento__brandword" }, "SUED"),
          el("p", { class: "doc-orcamento__brandcap" }, "Palácio · Espaço · Assessoria"),
        ]),
      ]),
      el("div", { class: "doc-orcamento__id" }, [
        el("p", { class: "doc-orcamento__kicker" }, "Proposta de orçamento"),
        el("p", { class: "doc-orcamento__number" }, data.number || "Rascunho"),
        el("p", { class: "doc-orcamento__date" }, formatDate(data.createdAt || new Date())),
        el("span", { class: `doc-orcamento__status doc-orcamento__status--${(data.status || "").toLowerCase()}` }, statusLabel),
      ]),
    ]),

    el("div", { class: "doc-orcamento__meta" }, [
      metaCol("Cliente", data.clientName || "—"),
      metaCol("Evento", data.eventTitle || "—"),
      metaCol("Válido até", data.validUntil ? formatDate(data.validUntil) : "—"),
    ]),

    el("table", { class: "doc-orcamento__items" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Descrição"),
          el("th", { style: "text-align:center" }, "Qtd"),
          el("th", { style: "text-align:right" }, "Preço un."),
          el("th", { style: "text-align:right" }, "Total"),
        ]),
      ]),
      el(
        "tbody",
        {},
        items.length
          ? items.map((i) =>
              el("tr", {}, [
                el("td", {}, i.description),
                el("td", { style: "text-align:center" }, String(i.quantity)),
                el("td", { style: "text-align:right" }, formatBRL(i.unitPriceCents)),
                el("td", { style: "text-align:right;font-weight:600" }, formatBRL(i.quantity * i.unitPriceCents)),
              ]),
            )
          : [el("tr", {}, [el("td", { colspan: "4", class: "text-muted", style: "text-align:center;padding:18px" }, "Nenhum item adicionado ainda.")])],
      ),
    ]),

    el("div", { class: "doc-orcamento__totals" }, [
      totalLine("Subtotal", formatBRL(subtotal)),
      discount ? totalLine("Desconto", "− " + formatBRL(discount)) : null,
      totalLine("Total", formatBRL(total), true),
    ]),

    data.notes
      ? el("div", { class: "doc-orcamento__notes" }, [
          el("p", { class: "doc-orcamento__notes-label" }, "Observações"),
          el("p", { class: "doc-orcamento__notes-text" }, data.notes),
        ])
      : null,

    el("footer", { class: "doc-orcamento__foot" }, [
      el("p", {}, "Palácio SUED · Espaço SUED · Assessoria SUED"),
      el("p", {}, "+25 anos realizando eventos em Teresina"),
    ]),
  ]);
}
