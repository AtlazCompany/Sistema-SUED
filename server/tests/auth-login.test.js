// Testes de ponta a ponta (HTTP real, servidor Express real) do fluxo de
// login/logout — SEM tocar no banco real. O módulo supabaseClient.js é
// substituído por um dublê controlado por teste (node:test mock.module),
// então nenhum dado de produção é lido ou necessário.
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";

const SUPA_URL = pathToFileURL(path.join(import.meta.dirname, "..", "supabaseClient.js")).href;

// Estado controlado pelos testes: o que a "consulta ao banco" do login deve
// devolver. null = nenhum usuário encontrado com aquele e-mail.
let mockUserRow = null;
// Captura o valor efetivamente interpolado na query (o e-mail já
// normalizado pelo backend) — usado para provar que .trim()/.toLowerCase()
// realmente rodam antes de ir para o SQL, não só no valor exibido.
let lastQueryEmailParam = null;
mock.module(SUPA_URL, {
  exports: {
    sql: (strings, ...values) => {
      lastQueryEmailParam = values[0];
      return Promise.resolve(mockUserRow ? [mockUserRow] : []);
    },
  },
});

const { authRouter } = await import("../auth.js");

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  // Mesmo handler central de erro de server/index.js — sem ele, HttpError
  // vira a página HTML padrão de erro do Express, não JSON.
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const SENHA_CERTA = "senha-correta-123";
const HASH_CERTO = bcrypt.hashSync(SENHA_CERTA, 10);

function usuarioFixture(overrides = {}) {
  return {
    id: "user-1",
    name: "Admin Teste",
    email: "admin@sued.com.br",
    role: "ADMIN",
    active: true,
    passwordHash: HASH_CERTO,
    ...overrides,
  };
}

async function login(email, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

test("login válido — 200, cookie setado, devolve o usuário (sem passwordHash)", async () => {
  mockUserRow = usuarioFixture();
  const res = await login("admin@sued.com.br", SENHA_CERTA);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user.email, "admin@sued.com.br");
  assert.equal(body.user.passwordHash, undefined, "hash da senha nunca deve voltar na resposta");
  assert.ok(res.headers.get("set-cookie")?.includes("sued_token="));
});

test("e-mail com espaços nas pontas — normalizado (trim) antes de ir para o SQL, login funciona", async () => {
  mockUserRow = usuarioFixture();
  const res = await login("  admin@sued.com.br  ", SENHA_CERTA);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(lastQueryEmailParam, "admin@sued.com.br", "o e-mail usado na consulta deveria estar sem espaços");
  assert.equal(body.user.email, "admin@sued.com.br");
});

test("e-mail com espaços e maiúsculas — normalizado (trim + lowercase)", async () => {
  mockUserRow = usuarioFixture();
  const res = await login("  ADMIN@SUED.COM.BR  ", SENHA_CERTA);
  assert.equal(res.status, 200);
  assert.equal(lastQueryEmailParam, "admin@sued.com.br");
});

test("logout — limpa a sessão", async () => {
  const res = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test("senha inválida — 401 com mensagem genérica", async () => {
  mockUserRow = usuarioFixture();
  const res = await login("admin@sued.com.br", "senha-errada");
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error, "E-mail ou senha inválidos.");
});

test("usuário inexistente — mesma resposta de senha inválida (não revela se o e-mail existe)", async () => {
  mockUserRow = null;
  const res = await login("ninguem@sued.com.br", "qualquer-coisa");
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error, "E-mail ou senha inválidos.");
});

test("usuário inativo — 401, mesmo com a senha certa", async () => {
  mockUserRow = usuarioFixture({ active: false });
  const res = await login("admin@sued.com.br", SENHA_CERTA);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error, "E-mail ou senha inválidos.");
});

test("GET /me — usuário ativo e logado: devolve o usuário, nunca o passwordHash", async () => {
  mockUserRow = usuarioFixture();
  const loginRes = await login("admin@sued.com.br", SENHA_CERTA);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user.email, "admin@sued.com.br");
  assert.equal(body.user.passwordHash, undefined, "passwordHash nunca deve aparecer em /me, mesmo vindo do banco");
});

test("GET /me — 9) usuário foi desativado depois do login → sessão não deve mais ser reconhecida (user: null)", async () => {
  mockUserRow = usuarioFixture();
  const loginRes = await login("admin@sued.com.br", SENHA_CERTA);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  // Simula o admin desativando esse usuário DEPOIS que o cookie já foi
  // emitido — mesmo JWT, mas o banco agora diz active:false.
  mockUserRow = usuarioFixture({ active: false });

  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = await res.json();
  assert.equal(res.status, 200, "/me sempre responde 200 — 'não logado' é um user:null, não um erro HTTP");
  assert.equal(body.user, null, "usuário desativado não deveria ser reconhecido como sessão válida");
});

test("GET /me — usuário removido do banco depois do login → user: null", async () => {
  mockUserRow = usuarioFixture();
  const loginRes = await login("admin@sued.com.br", SENHA_CERTA);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  mockUserRow = null; // usuário excluído
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user, null);
});

test("achado B7 — sessão emitida antes de uma troca de senha (tokenVersion incrementado) deixa de ser reconhecida", async () => {
  mockUserRow = usuarioFixture({ tokenVersion: 0 });
  const loginRes = await login("admin@sued.com.br", SENHA_CERTA);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  // Confirma que a sessão vale normalmente logo após o login.
  const before = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await before.json()).user?.email, "admin@sued.com.br");

  // Simula a senha tendo sido trocada em outro lugar (própria conta em
  // outra aba, ou um admin redefinindo por ela) — o banco passa a refletir
  // um tokenVersion mais novo do que o gravado no cookie já emitido.
  mockUserRow = usuarioFixture({ tokenVersion: 1 });

  const after = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = await after.json();
  assert.equal(after.status, 200);
  assert.equal(body.user, null, "cookie antigo (tokenVersion desatualizado) não deveria mais ser reconhecido");
});

test("GET /me — sem cookie → user: null", async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user, null);
});

test("rate limit — bloqueia após tentativas malsucedidas repetidas, com Retry-After", async () => {
  mockUserRow = usuarioFixture();
  let blocked = null;
  for (let i = 0; i < 10 && !blocked; i++) {
    const res = await login("admin@sued.com.br", "senha-errada-de-novo");
    if (res.status === 429) blocked = res;
  }
  assert.ok(blocked, "esperava receber 429 dentro de 10 tentativas malsucedidas");
  assert.ok(blocked.headers.get("retry-after"));
  const body = await blocked.json();
  assert.match(body.error, /muitas tentativas/i);
});

test("rate limit — bloqueia mesmo com a senha certa, enquanto a janela estiver ativa", async () => {
  mockUserRow = usuarioFixture();
  const res = await login("admin@sued.com.br", SENHA_CERTA);
  assert.equal(res.status, 429, "bloqueio é por IP, não por credencial — mesmo login certo deve ser barrado agora");
});
