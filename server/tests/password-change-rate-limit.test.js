// Fase 5 / Lote 1 — achado B6: PUT /api/auth/senha não tinha limite de
// tentativas, permitindo adivinhar a senha atual sem bloqueio (ex.: com um
// cookie de sessão roubado). Testes de ponta a ponta (HTTP real, servidor
// Express real), SEM tocar no banco real — mesmo dublê de
// tests/auth-login.test.js, já que o comportamento sob teste é só o
// middleware de rate limit, não a lógica de banco em si.
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";

const SUPA_URL = pathToFileURL(path.join(import.meta.dirname, "..", "supabaseClient.js")).href;

const SENHA_CERTA = "senha-correta-123";
const HASH_CERTO = bcrypt.hashSync(SENHA_CERTA, 10);

// Dois usuários fixos e independentes — cada bloco de teste usa o seu, para
// que o contador de tentativas (chaveado por id de usuário) de um teste
// nunca influencie o outro.
const USER_A = { id: "rl-user-a", name: "Rate Limit A", email: "rl.a@sued.local", role: "ADMIN", active: true, passwordHash: HASH_CERTO };
const USER_B = { id: "rl-user-b", name: "Rate Limit B", email: "rl.b@sued.local", role: "ADMIN", active: true, passwordHash: HASH_CERTO };
const usersById = { [USER_A.id]: USER_A, [USER_B.id]: USER_B };
const usersByEmail = { [USER_A.email]: USER_A, [USER_B.email]: USER_B };

// O dublê responde à consulta de login (por e-mail) e à de
// requireAuth/resolveSession + PUT /senha (por id) — procura, entre TODOS
// os valores interpolados (não só o primeiro), um que bata com um usuário
// conhecido. Precisa ser assim (não só `values[0]`) porque o UPDATE de
// troca de senha interpola o hash da nova senha ANTES do id na cláusula
// WHERE (`set "passwordHash" = ${...}, "tokenVersion" = ... where id =
// ${...}`) — usar só o primeiro valor pegaria o hash, não o id.
mock.module(SUPA_URL, {
  exports: {
    sql: (strings, ...values) => {
      const row = values.map((v) => usersByEmail[v] || usersById[v]).find(Boolean) || null;
      return Promise.resolve(row ? [row] : []);
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
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message || "Erro interno." }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function loginAs(user) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: SENHA_CERTA }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

async function tryChangePassword(cookie, currentPassword) {
  return fetch(`${baseUrl}/api/auth/senha`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ currentPassword, newPassword: "nova-senha-1234", confirmNewPassword: "nova-senha-1234" }),
  });
}

test("PUT /auth/senha — dentro do limite: senha atual errada continua 401 (não bloqueia cedo demais)", async () => {
  const cookie = await loginAs(USER_A);
  for (let i = 0; i < 3; i++) {
    const res = await tryChangePassword(cookie, "senha-errada");
    assert.equal(res.status, 401, `tentativa ${i + 1} deveria ser 401, não bloqueio`);
  }
});

test("PUT /auth/senha — 8 tentativas com senha atual errada, a 9ª é bloqueada com 429 e Retry-After", async () => {
  const cookie = await loginAs(USER_B);
  let blocked = null;
  for (let i = 0; i < 8; i++) {
    const res = await tryChangePassword(cookie, "senha-errada");
    assert.equal(res.status, 401, `tentativa ${i + 1} deveria ser 401 (ainda dentro do limite)`);
  }
  const res9 = await tryChangePassword(cookie, "senha-errada");
  assert.equal(res9.status, 429, "9ª tentativa deveria ser bloqueada");
  assert.ok(res9.headers.get("retry-after"), "deveria informar Retry-After");
  const body = await res9.json();
  assert.match(body.error, /muitas tentativas/i);
  blocked = res9;
  assert.ok(blocked);
});

test("PUT /auth/senha — bloqueio persiste mesmo com a senha CERTA, enquanto a janela estiver ativa (mesmo comportamento do login)", async () => {
  const cookie = await loginAs(USER_B); // mesmo usuário do teste anterior — já está bloqueado
  const res = await tryChangePassword(cookie, SENHA_CERTA);
  assert.equal(res.status, 429, "bloqueio é por conta, não por credencial certa/errada — mesma regra do rate limit de login");
});

test("PUT /auth/senha — erro de validação (sem confirmação) não consome a cota de tentativas", async () => {
  const bcrypt2 = (await import("bcryptjs")).default;
  const userC = { id: "rl-user-c", name: "Rate Limit C", email: "rl.c@sued.local", role: "ADMIN", active: true, passwordHash: bcrypt2.hashSync(SENHA_CERTA, 10) };
  usersById[userC.id] = userC;
  usersByEmail[userC.email] = userC;
  const cookie = await loginAs(userC);

  // 8 requisições SEM confirmNewPassword — erro de validação (400), não
  // tentativa de adivinhar a senha atual.
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ currentPassword: SENHA_CERTA, newPassword: "nova-senha-1234" }), // sem confirmNewPassword
    });
    assert.equal(res.status, 400, `tentativa ${i + 1} deveria ser 400 (validação), não consumir a cota`);
  }
  // Depois de 8 erros de validação, a troca de verdade (com senha certa e
  // confirmação) ainda deveria funcionar normalmente — a cota de tentativas
  // não foi tocada por erros de validação.
  const res = await fetch(`${baseUrl}/api/auth/senha`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ currentPassword: SENHA_CERTA, newPassword: "nova-senha-1234", confirmNewPassword: "nova-senha-1234" }),
  });
  assert.equal(res.status, 200, "não deveria estar bloqueado — erros de validação não contam como tentativa de adivinhação");
});
