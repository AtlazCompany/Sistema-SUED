// Testes de integração REAIS (banco real) para dois achados da Fase 2
// (pendências P2): UUID malformado devolvendo 500 em vez de 400, e data
// inválida em Evento devolvendo 500 com mensagem técnica em vez de 400
// amigável. Mesmo padrão de tests/usuarios.test.js: servidor Express local
// real, banco real, dado de teste prefixado com "audit.fase2." e removido no
// final. Pula graciosamente se não houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { clientesRouter } from "../routes/clientes.js";
import { eventosRouter } from "../routes/eventos.js";
import { authRouter } from "../auth.js";

// Prefixo próprio (não "audit.fase2.") de propósito: este arquivo roda em
// paralelo a tests/usuarios.test.js (Node test runner executa arquivos de
// teste concorrentemente), e aquele arquivo faz limpeza por LIKE no prefixo
// "audit.fase2.%" — um prefixo compartilhado faria um arquivo apagar a
// conta de admin de bootstrap que o outro ainda está usando (reproduzido e
// corrigido nesta própria sessão).
const EMAIL_PREFIX = "audit.fase2err.";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;

try {
  sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 3, connect_timeout: 5 });
  await sql`select 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

before(async () => {
  if (!dbAvailable) return;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  app.use("/api/clientes", clientesRouter);
  app.use("/api/eventos", eventosRouter);
  // Mesmo tratamento central de server/index.js, incluindo o mapeamento de
  // erro 22P02 (UUID inválido) — sem ele este teste não provaria nada.
  app.use((err, req, res, _next) => {
    if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
    res.status(err.status || 500).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!dbAvailable) return;
  // Limpeza por id específico (não por LIKE no prefixo) — este arquivo roda
  // em paralelo a tests/usuarios.test.js, que usa o mesmo prefixo
  // "audit.fase2."; um DELETE por LIKE aqui apagaria linhas do outro arquivo
  // ainda em uso (achado durante esta própria sessão de testes).
  if (bootstrapId) await sql`delete from "User" where id = ${bootstrapId}`;
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

test("erros amigáveis (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  const { randomUUID } = await import("node:crypto");
  bootstrapId = randomUUID();
  const bootstrapEmail = EMAIL_PREFIX + "erros-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (teste erros)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  await t.test("GET /api/clientes/:id com UUID malformado → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/id-nao-e-um-uuid`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "ID inválido.");
  });

  await t.test("PUT /api/clientes/:id com UUID malformado → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/id-nao-e-um-uuid`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("POST /api/eventos com eventDate inválida → 400 amigável (não 500 'Invalid time value')", async () => {
    const res = await fetch(`${baseUrl}/api/eventos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Evento de teste (data inválida)", eventDate: "isso-nao-e-uma-data" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /data do evento inválida/i);
  });

  await t.test("POST /api/eventos com eventDate válida → segue funcionando normalmente", async () => {
    const res = await fetch(`${baseUrl}/api/eventos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "AUDIT-FASE2 Evento data válida", eventDate: "2026-12-01" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    await sql`delete from "Event" where id = ${body.id}`;
  });

  await t.test("limpeza — o admin de bootstrap deste arquivo foi removido", async () => {
    await sql`delete from "User" where id = ${bootstrapId}`;
    const [leftover] = await sql`select id from "User" where id = ${bootstrapId}`;
    assert.equal(leftover, undefined);
  });
});
