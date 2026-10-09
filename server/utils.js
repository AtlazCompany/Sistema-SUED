// Utilitários reutilizáveis do backend.
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

// O schema veio do Prisma, que gerava id/updatedAt na aplicação (sem default
// no banco). Ao inserir via SQL, injetamos esses campos aqui.
// Tabelas sem coluna "updatedAt" (ex.: Interaction) → { updatedAt: false }.
export function prepInsert(data, { updatedAt = true } = {}) {
  const now = new Date();
  const base = { id: randomUUID(), createdAt: now };
  if (updatedAt) base.updatedAt = now;
  return { ...base, ...data };
}

// Para tabelas que só têm "id" (sem createdAt/updatedAt), ex.: Transaction.
export function withId(data) {
  return { id: randomUUID(), ...data };
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

// IP real do visitante, usado como chave dos rate limits. Atrás do
// Cloudflare/Render, req.ip é o IP do proxy — todos os visitantes dividiam
// o mesmo contador. O Cloudflare SOBRESCREVE o cabeçalho configurado
// (cf-connecting-ip), então ele não pode ser forjado pelo cliente; já o
// X-Forwarded-For (que "trust proxy" usaria) é repassado pelo Render sem
// filtro e seria forjável. Sem cabeçalho configurado (local) → req.ip.
export function clientIp(req, header = config.clientIpHeader) {
  const raw = header ? req.headers[header] : null;
  const first = typeof raw === "string" ? raw.split(",")[0].trim() : "";
  return first || req.ip;
}

// Tratamento central de erros (usado por server/index.js). Erro de regra de
// negócio (HttpError) ou do próprio Express com status < 500 mantém a
// mensagem; erro inesperado (500) vai inteiro para o log e o visitante
// recebe só uma mensagem genérica — nunca detalhe de banco/infraestrutura.
export function errorHandler(err, req, res, _next) {
  // Postgres 22P02 = "invalid text representation" — normalmente um UUID
  // malformado num parâmetro de rota (ex.: GET /api/clientes/id-invalido).
  if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    const message = err instanceof HttpError ? err.message : "Erro interno do servidor. Tente novamente em instantes.";
    return res.status(status).json({ error: message });
  }
  res.status(status).json({ error: err.message || "Requisição inválida." });
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

// Achado B13 (Fase 5): paginação opcional para as listagens de maior risco
// de crescimento. Sem "page"/"pageSize" na query, `paginated` vem `false` e
// o chamador deve rodar a MESMA consulta de sempre, sem LIMIT/OFFSET —
// resposta idêntica à anterior, nenhuma mudança de comportamento. Só
// quando os dois parâmetros vêm como inteiros positivos é que a paginação
// entra em ação; `pageSize` é limitado a 200 para evitar abuso.
const MAX_PAGE_SIZE = 200;

export function parsePagination(query) {
  const page = Number(query?.page);
  const pageSize = Number(query?.pageSize);
  const paginated = Number.isInteger(page) && page > 0 && Number.isInteger(pageSize) && pageSize > 0;
  if (!paginated) return { paginated: false };
  const cappedSize = Math.min(pageSize, MAX_PAGE_SIZE);
  return { paginated: true, page, pageSize: cappedSize, offset: (page - 1) * cappedSize };
}

// Converte para Date válido ou null (campo opcional); string/valor
// não-parseável vira 400 amigável em vez de virar "Invalid time value" (500)
// lá na frente, no INSERT/UPDATE.
export function toDateOrNull(value, label = "Data") {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} inválida.`);
  return d;
}

// Soma `months` meses a uma data "só-dia" (UTC) mantendo o dia do mês; quando
// o mês de destino é mais curto, usa o último dia (31/jan + 1 mês = 28/fev).
export function addMonthsClamped(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

// Igual a toDateOrNull, mas o campo é obrigatório.
export function toDate(value, label = "Data") {
  const d = toDateOrNull(value, label);
  if (d === null) throw new HttpError(400, `Informe: ${label.toLowerCase()}.`);
  return d;
}

// Achado B2 (Fase 5): valida transição de status/estágio. `order` é a
// sequência normal de avanço (só permite ir pra frente, nunca voltar,
// pular etapas é permitido); `terminal` são status "definitivos" —
// alcançáveis como saída a partir de qualquer estado não-terminal da
// sequência (ex.: CANCELADO a qualquer momento), mas sem nenhuma saída
// depois de alcançados. Ficar no mesmo status é sempre permitido (não é
// uma "transição").
export function assertValidTransition(current, next, { order, terminal = [] }, label = "status") {
  if (current === next) return;
  if (terminal.includes(current))
    throw new HttpError(400, `Não é possível alterar o ${label}: "${current}" é definitivo.`);
  const isForward = order.includes(current) && order.includes(next) && order.indexOf(next) > order.indexOf(current);
  const isTerminalExit = terminal.includes(next);
  if (!isForward && !isTerminalExit)
    throw new HttpError(400, `Transição de ${label} inválida: não é possível voltar de "${current}" para "${next}".`);
}
