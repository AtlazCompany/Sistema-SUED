// Fase 5 / Lote 9 — achado real em produção (07/10/2026): com o banco
// inacessível, POST /api/auth/login respondia 500 com a mensagem crua do
// driver ("(ENOTFOUND) tenant/user postgres.<projeto> not found"), expondo
// detalhe de infraestrutura ao visitante. Teste puro do tratamento central
// de erros (server/utils.js → errorHandler), sem banco nem servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorHandler, HttpError } from "../utils.js";

function run(err) {
  const out = {};
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  const original = console.error;
  console.error = () => {}; // o handler registra o 500 no log; aqui só silencia
  try { errorHandler(err, {}, res, () => {}); } finally { console.error = original; }
  return out;
}

test("erro inesperado (500) → mensagem genérica, sem detalhe técnico", () => {
  const out = run(new Error("(ENOTFOUND) tenant/user postgres.abc not found"));
  assert.equal(out.status, 500);
  assert.doesNotMatch(out.body.error, /ENOTFOUND|postgres|tenant/);
});

test("HttpError de regra de negócio → mantém status e mensagem", () => {
  const out = run(new HttpError(400, "Desconto maior que o subtotal."));
  assert.deepEqual(out, { status: 400, body: { error: "Desconto maior que o subtotal." } });
});

test("UUID malformado (Postgres 22P02) → 400 'ID inválido.'", () => {
  const err = Object.assign(new Error("invalid input syntax for type uuid"), { code: "22P02" });
  assert.deepEqual(run(err), { status: 400, body: { error: "ID inválido." } });
});

test("JSON malformado no corpo (body-parser, 400) → mantém mensagem do Express", () => {
  const err = Object.assign(new Error("Unexpected token"), { status: 400, expose: true });
  assert.equal(run(err).status, 400);
});
