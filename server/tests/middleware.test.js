// Testes de requireAuth / requireRole — SEM banco real. O módulo
// supabaseClient.js é substituído por um dublê controlado por teste
// (node:test mock.module), então nenhum dado de produção é lido ou
// necessário. O JWT é assinado/verificado com o JWT_SECRET real do .env
// (necessário para node --env-file=.env rodar).
//
// Desde a correção do achado P1 "sessão não revalidada" (ver
// audit/phase2/16-*.txt), requireAuth passou a recarregar o usuário do
// banco a cada requisição — active/role/nome/e-mail vêm sempre do banco,
// nunca do JWT antigo. Esses testes cobrem exatamente esse comportamento.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { rolesForModule } from "../../public/src/roles.js";

const SUPA_URL = pathToFileURL(path.join(import.meta.dirname, "..", "supabaseClient.js")).href;

// Estado controlado pelos testes: o que a "consulta ao banco" feita por
// requireAuth deve devolver para o id do JWT. null = usuário não existe
// mais (removido). Inclui passwordHash de propósito — mesmo estando lá na
// linha do banco, requireAuth nunca deveria repassar isso para req.user.
let mockUserRow = null;
mock.module(SUPA_URL, {
  exports: { sql: () => Promise.resolve(mockUserRow ? [mockUserRow] : []) },
});

// Importado DEPOIS do mock.module, como o padrão já usado em
// tests/auth-login.test.js — garante que auth.js recebe o dublê.
const { requireAuth, requireRole } = await import("../auth.js");

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function signToken(payload, opts = {}) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "1h", ...opts });
}

function userRowFixture(overrides = {}) {
  return {
    id: "u1",
    name: "Ana",
    email: "ana@sued.com.br",
    role: "ADMIN",
    active: true,
    passwordHash: "NAO-DEVERIA-APARECER-EM-NENHUMA-RESPOSTA",
    ...overrides,
  };
}

// requireAuth agora é async (consulta o banco) — precisa ser aguardado
// antes de checar o resultado.
async function run(req, res) {
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  return nextCalled;
}

test("1) JWT válido + usuário ativo no banco → next() chamado, req.user vem do banco", async () => {
  mockUserRow = userRowFixture({ role: "ADMIN" });
  const token = signToken({ id: "u1" });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "ADMIN");
  assert.equal(req.user.id, "u1");
  assert.equal(req.user.passwordHash, undefined, "passwordHash nunca deve chegar em req.user");
});

test("2) JWT válido + usuário desativado no banco → 401", async () => {
  mockUserRow = userRowFixture({ active: false });
  const token = signToken({ id: "u1", role: "ADMIN" });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /desativad/i);
});

test("3) JWT válido + usuário removido do banco → 401", async () => {
  mockUserRow = null;
  const token = signToken({ id: "u1", role: "ADMIN" });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("4) JWT com role antigo (COMERCIAL) + role alterado no banco (FINANCEIRO) → middleware usa o novo", async () => {
  mockUserRow = userRowFixture({ role: "FINANCEIRO" });
  const token = signToken({ id: "u1", role: "COMERCIAL" }); // role do token está desatualizado de propósito
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "FINANCEIRO", "deveria usar o role atual do banco, não o do token");
});

test("5) requireRole encadeado depois de requireAuth usa o role atual (do banco), não o do token", async () => {
  mockUserRow = userRowFixture({ role: "FINANCEIRO" });
  const token = signToken({ id: "u1", role: "COMERCIAL" });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  let reachedHandler = false;
  await requireAuth(req, res, () => {
    requireRole(...rolesForModule("financeiro"))(req, res, () => { reachedHandler = true; });
  });
  assert.equal(reachedHandler, true, "FINANCEIRO (banco) deveria acessar o módulo financeiro, mesmo com token dizendo COMERCIAL");
});

test("5b) requireRole encadeado bloqueia quando o role atual (banco) não tem acesso, mesmo com token permitindo", async () => {
  mockUserRow = userRowFixture({ role: "OPERACIONAL" }); // banco: sem acesso a financeiro
  const token = signToken({ id: "u1", role: "FINANCEIRO" }); // token: teria acesso — não deve valer
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  let reachedHandler = false;
  await requireAuth(req, res, () => {
    requireRole(...rolesForModule("financeiro"))(req, res, () => { reachedHandler = true; });
  });
  assert.equal(reachedHandler, false);
  assert.equal(res.statusCode, 403);
});

test("6) sem cookie → 401", async () => {
  const req = { cookies: {} };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("6b) JWT inválido/adulterado → 401", async () => {
  const req = { cookies: { [config.cookieName]: "token.invalido.aqui" } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("7) JWT expirado → 401", async () => {
  mockUserRow = userRowFixture();
  const token = signToken({ id: "u1" }, { expiresIn: -10 });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("9) achado B7 — JWT com tokenVersion desatualizado (senha trocada em outro lugar) → 401", async () => {
  mockUserRow = userRowFixture({ tokenVersion: 3 }); // senha já foi trocada 3x desde que este token foi emitido
  const token = signToken({ id: "u1", tokenVersion: 0 });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /senha foi alterada/i);
});

test("9b) achado B7 — JWT com tokenVersion igual ao do banco (não-zero) → next() chamado normalmente", async () => {
  mockUserRow = userRowFixture({ tokenVersion: 3 });
  const token = signToken({ id: "u1", tokenVersion: 3 });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, "u1");
});

test("8) usuário nunca existiu (id do token não bate com nada no banco) → 401", async () => {
  mockUserRow = null;
  const token = signToken({ id: "id-que-nunca-existiu" });
  const req = { cookies: { [config.cookieName]: token } };
  const res = mockRes();
  const nextCalled = await run(req, res);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("requireRole — papel correto chama next()", () => {
  const mw = requireRole("ADMIN", "SOCIO");
  const req = { user: { role: "ADMIN" } };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requireRole — papel incorreto retorna 403", () => {
  const mw = requireRole("ADMIN", "SOCIO");
  const req = { user: { role: "OPERACIONAL" } };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("requireRole — sem req.user (nunca passou por requireAuth) retorna 403", () => {
  const mw = requireRole("ADMIN");
  const req = {};
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("endpoint protegido — sem autenticação nunca chega em requireRole (401 primeiro)", async () => {
  const req = { cookies: {} };
  const res = mockRes();
  let reachedRoleCheck = false;
  await requireAuth(req, res, () => {
    reachedRoleCheck = true;
    requireRole(...rolesForModule("financeiro"))(req, res, () => {});
  });
  assert.equal(reachedRoleCheck, false);
  assert.equal(res.statusCode, 401);
});
