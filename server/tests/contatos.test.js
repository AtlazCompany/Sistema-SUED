// Fase 5 / Lote 2 — achado B8: CRUD de Contact (contatos do cliente).
// Antes só existia leitura (embutida em GET /api/clientes/:id) — sem
// nenhuma rota para criar/editar/excluir. Testes de integração reais
// (banco real, servidor Express real), dados prefixados "audit.fase5." /
// "AUDIT-FASE5-", removidos ao final com checagem que falha o processo se
// sobrar algum. Pula graciosamente se não houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { clientesRouter } from "../routes/clientes.js";

const TAG = "AUDIT-FASE5-CONTACT-";
const FAKE_ID = "00000000-0000-0000-0000-000000000000";
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

async function loginAs(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  return { res, cookie: setCookie ? setCookie.split(";")[0] : null };
}

test("CRUD de contatos do cliente (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.contatos-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - Contact)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const { cookie: adminCookie, res: loginRes } = await loginAs(bootstrapEmail, bootstrapPassword);
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");

  const clientId = randomUUID();
  await sql`insert into "Client" ${sql({ id: clientId, personType: "PF", name: TAG + "Cliente", createdAt: new Date(), updatedAt: new Date() })}`;
  const createdContacts = [];

  await t.test("POST /clientes/:clientId/contatos — nome vazio → 400", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${clientId}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("POST /clientes/:clientId/contatos — clientId inexistente → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${FAKE_ID}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: TAG + "Contato inválido" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /não existe mais/);
  });

  let contactA, contactB;
  await t.test("POST /clientes/:clientId/contatos — cria com sucesso (201)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${clientId}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: TAG + "Contato A", primary: true }),
    });
    contactA = await res.json();
    assert.equal(res.status, 201);
    assert.equal(contactA.primary, true);
    createdContacts.push(contactA.id);
  });

  await t.test("GET /clientes/:id — contato criado aparece embutido", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${clientId}`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.contacts.some((c) => c.id === contactA.id));
  });

  await t.test("POST — segundo contato marcado como principal desmarca o primeiro (mesmo padrão de SupplierProduct.isDefault)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${clientId}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: TAG + "Contato B", primary: true }),
    });
    contactB = await res.json();
    assert.equal(res.status, 201);
    assert.equal(contactB.primary, true);
    createdContacts.push(contactB.id);

    const [rowA] = await sql`select "primary" from "Contact" where id = ${contactA.id}`;
    assert.equal(rowA.primary, false, "contato A deveria ter deixado de ser o principal");
  });

  await t.test("PUT /clientes/contatos/:id — renomeia e pode voltar a marcar como principal (desmarcando o outro)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/contatos/${contactA.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: TAG + "Contato A (renomeado)", primary: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.name, TAG + "Contato A (renomeado)");
    assert.equal(body.primary, true);

    const [rowB] = await sql`select "primary" from "Contact" where id = ${contactB.id}`;
    assert.equal(rowB.primary, false, "contato B deveria ter deixado de ser o principal");
  });

  await t.test("PUT /clientes/contatos/:id — contato inexistente → 404", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/contatos/${FAKE_ID}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(res.status, 404);
  });

  await t.test("PUT /clientes/contatos/:id — UUID inválido → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/contatos/id-invalido`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("RBAC — COMERCIAL acessa (módulo crm), OPERACIONAL não acessa", async () => {
    const criarELogar = async (role, emailLocal) => {
      const id = randomUUID();
      const { default: bcryptX } = await import("bcryptjs");
      const email = "audit.fase5." + emailLocal + "@sued.local";
      await sql`insert into "User" ${sql({ id, name: `Fase5 ${role}`, email, role, active: true, passwordHash: await bcryptX.hash("senha-rbac-123", 10) })}`;
      const { cookie } = await loginAs(email, "senha-rbac-123");
      return { id, cookie };
    };
    const comercial = await criarELogar("COMERCIAL", "contatos-comercial");
    const resComercial = await fetch(`${baseUrl}/api/clientes/${clientId}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: comercial.cookie },
      body: JSON.stringify({ name: TAG + "Via Comercial" }),
    });
    assert.equal(resComercial.status, 201, "COMERCIAL tem acesso ao módulo crm");
    const bodyComercial = await resComercial.json();
    createdContacts.push(bodyComercial.id);
    await sql`delete from "User" where id = ${comercial.id}`;

    const operacional = await criarELogar("OPERACIONAL", "contatos-operacional");
    const resOperacional = await fetch(`${baseUrl}/api/clientes/${clientId}/contatos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: operacional.cookie },
      body: JSON.stringify({ name: TAG + "Via Operacional" }),
    });
    assert.equal(resOperacional.status, 403);
    await sql`delete from "User" where id = ${operacional.id}`;
  });

  await t.test("DELETE /clientes/contatos/:id — remove com sucesso", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/contatos/${contactB.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const leftover = await sql`select id from "Contact" where id = ${contactB.id}`;
    assert.equal(leftover.length, 0);
    createdContacts.splice(createdContacts.indexOf(contactB.id), 1);
  });

  await t.test("DELETE /clientes/:id — cliente com contato vinculado → 409 (reconfirmação do padrão de FK-guard já existente)", async () => {
    const res = await fetch(`${baseUrl}/api/clientes/${clientId}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 409);
  });

  await t.test("limpeza — nenhum dado AUDIT-FASE5-CONTACT-* residual", async () => {
    await sql`delete from "Contact" where "clientId" = ${clientId}`;
    await sql`delete from "Client" where id = ${clientId}`;
    await sql`delete from "User" where email like ${"audit.fase5.contatos%"}`;

    const leftoverContacts = await sql`select id from "Contact" where name like ${TAG + "%"}`;
    const leftoverClients = await sql`select id from "Client" where name like ${TAG + "%"}`;
    const leftoverUsers = await sql`select email from "User" where email like ${"audit.fase5.contatos%"}`;
    assert.equal(leftoverContacts.length, 0, "Contact");
    assert.equal(leftoverClients.length, 0, "Client");
    assert.equal(leftoverUsers.length, 0, "User");
  });
});
