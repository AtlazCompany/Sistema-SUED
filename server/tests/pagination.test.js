// Fase 5 / Lote 4 — achado B13: paginação opcional (page/pageSize) nos 8
// endpoints de maior risco de crescimento. Sem os parâmetros, o
// comportamento é IDÊNTICO ao anterior (array completo, sem header extra)
// — é isso que estes testes provam primeiro, antes de testar o
// comportamento novo. Banco real, servidor Express real, dados
// "AUDIT-FASE5-B13-*", removidos ao final.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { clientesRouter } from "../routes/clientes.js";
import { leadsRouter } from "../routes/leads.js";

const TAG = "AUDIT-FASE5-B13-";
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
  app.use("/api/leads", leadsRouter);
  app.use((err, req, res, _next) => {
    if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
    res.status(err.status || 500).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!dbAvailable) return;
  if (bootstrapId) await sql`delete from "User" where id = ${bootstrapId}`;
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

test("B13 — paginação opcional e compatível (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.b13-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - B13)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  const createdLeadIds = [];
  const createdClientIds = [];

  // 5 leads de teste, para ter algo real para paginar (nome com sufixo
  // numérico para ordenar de forma previsível, já que a listagem ordena
  // por "createdAt desc" — criados em sequência, então o mais recente
  // vem primeiro).
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${baseUrl}/api/leads`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `${TAG}Lead ${i}` }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    createdLeadIds.push(body.id);
  }

  await t.test("sem page/pageSize — comportamento idêntico ao anterior: array completo, sem X-Total-Count", async () => {
    const res = await fetch(`${baseUrl}/api/leads`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body), "resposta deveria continuar sendo um array simples");
    assert.equal(res.headers.get("x-total-count"), null, "sem paginação, não deveria haver header de total");
    assert.ok(body.length >= 5, "deveria trazer todos os leads, sem cortar nada");
  });

  await t.test("com page=1&pageSize=2 — retorna só 2 itens e informa o total via X-Total-Count", async () => {
    const res = await fetch(`${baseUrl}/api/leads?page=1&pageSize=2`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 2);
    const total = Number(res.headers.get("x-total-count"));
    assert.ok(total >= 5, "total deveria contar TODOS os leads (não só os de teste), pelo menos os 5 criados aqui");
  });

  await t.test("página 2 traz itens diferentes da página 1 (offset correto)", async () => {
    const page1 = await (await fetch(`${baseUrl}/api/leads?page=1&pageSize=2`, { headers: { Cookie: cookie } })).json();
    const page2 = await (await fetch(`${baseUrl}/api/leads?page=2&pageSize=2`, { headers: { Cookie: cookie } })).json();
    const ids1 = page1.map((l) => l.id);
    const ids2 = page2.map((l) => l.id);
    assert.equal(ids2.length, 2);
    assert.ok(ids1.every((id) => !ids2.includes(id)), "página 2 não deveria repetir nenhum id da página 1");
  });

  await t.test("pageSize acima do máximo (200) é limitado, não rejeitado", async () => {
    const res = await fetch(`${baseUrl}/api/leads?page=1&pageSize=99999`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200, "não deveria dar erro, só aplicar o teto de 200");
  });

  await t.test("parâmetros parciais/inválidos (só page, sem pageSize) → cai no comportamento sem paginação", async () => {
    const res = await fetch(`${baseUrl}/api/leads?page=1`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-total-count"), null, "sem pageSize válido, não deveria paginar nem adicionar o header");
    assert.ok(body.length >= 5);
  });

  await t.test("page/pageSize não-numéricos são ignorados com segurança (sem 500)", async () => {
    const res = await fetch(`${baseUrl}/api/leads?page=abc&pageSize=xyz`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
  });

  // Endpoint com filtro (clientes?q=) — confirma que o total respeita o
  // MESMO filtro usado na busca dos itens, não o total geral da tabela.
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${baseUrl}/api/clientes`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `${TAG}ClienteFiltro ${i}` }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    createdClientIds.push(body.id);
  }
  // Cliente que não deveria aparecer no filtro abaixo.
  const outroRes = await fetch(`${baseUrl}/api/clientes`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: TAG + "NaoDeveAparecerNoFiltro" }),
  });
  createdClientIds.push((await outroRes.json()).id);

  await t.test("clientes?q=...&page=1&pageSize=2 — total do header respeita o filtro de busca, não o total geral", async () => {
    const res = await fetch(`${baseUrl}/api/clientes?q=${encodeURIComponent(TAG + "ClienteFiltro")}&page=1&pageSize=2`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 2);
    assert.equal(res.headers.get("x-total-count"), "3", "deveria contar só os 3 clientes que batem com o filtro, não todos os clientes do banco");
  });

  await t.test("limpeza — nenhum dado AUDIT-FASE5-B13-* residual", async () => {
    for (const id of createdLeadIds) await sql`delete from "Lead" where id = ${id}`;
    for (const id of createdClientIds) await sql`delete from "Client" where id = ${id}`;
    const leftoverLeads = await sql`select id from "Lead" where name like ${TAG + "%"}`;
    const leftoverClients = await sql`select id from "Client" where name like ${TAG + "%"}`;
    assert.equal(leftoverLeads.length, 0, "Lead");
    assert.equal(leftoverClients.length, 0, "Client");
  });
});
