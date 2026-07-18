// Utilitários reutilizáveis do backend.
import { randomUUID } from "node:crypto";

// O schema veio do Prisma, que gerava id/updatedAt na aplicação (sem default
// no banco). Ao inserir via SQL, injetamos esses campos aqui.
export function prepInsert(data) {
  const now = new Date();
  return { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
}

// Envolve handlers async para encaminhar erros ao middleware central.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Erro de aplicação com status HTTP.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Converte "12.500,00" (reais) → 1250000 (centavos). Aceita number também.
export function toCents(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n =
    typeof value === "string"
      ? Number(value.replace(/\./g, "").replace(",", "."))
      : value;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Normaliza string vazia para null (para colunas opcionais).
export const nn = (v) => (v === undefined || v === null || v === "" ? null : v);
