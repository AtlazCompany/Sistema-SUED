// Regra de impostos do orçamento — fonte única, compartilhada entre o
// backend (server/routes/orcamentos.js) e o frontend (editor, lista e
// documento da proposta), no mesmo padrão de roles.js.
//
// Todo orçamento novo ou salvo leva 20% de impostos, somados ao total do
// cliente: total = (subtotal − desconto) + 20% × (subtotal − desconto).
// Orçamentos antigos (anteriores a esta regra) ficam gravados com 0% e
// seguem com o valor de antes.
export const TAX_RATE_PERCENT = 20;

/** Tudo em centavos (inteiros). `taxRatePercent` 0 = sem imposto (orçamento antigo). */
export function calcBudgetTotals({ subtotalCents, discountCents = 0, costCents = 0, taxRatePercent = 0 }) {
  const subtotal = Number(subtotalCents) || 0;
  const discount = Number(discountCents) || 0;
  const cost = Number(costCents) || 0;
  const base = subtotal - discount;
  const taxCents = Math.round((base * (Number(taxRatePercent) || 0)) / 100);
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    baseCents: base,
    taxCents,
    totalCents: base + taxCents,
    costCents: cost,
    // O imposto é repassado, não é receita da SUED: lucro e margem saem da base.
    profitCents: base - cost,
    marginPercent: base > 0 ? ((base - cost) / base) * 100 : null,
  };
}

export const TAX_REMINDER =
  `Lembrete: todo orçamento inclui ${TAX_RATE_PERCENT}% de impostos, somados ao total do cliente.`;
