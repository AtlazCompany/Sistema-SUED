// Fase 5 / Lote 3 — achados B11 (gestão mínima de Tipos de Evento) e B12
// (edição de Locais). Testes de integração reais (banco real, servidor
// Express real), dados prefixados "AUDIT-FASE5-", removidos ao final com
// checagem que falha o processo se sobrar algum. Pula graciosamente se não
// houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { eventosRouter, locaisRouter, tiposEventoRouter } from "../routes/eventos.js";

const TAG = "AUDIT-FASE5-B11B12-";
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
  app.use("/api/eventos", eventosRouter);
  app.use("/api/locais", locaisRouter);
  app.use("/api/tipos-evento", tiposEventoRouter);
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

test("B11 (Tipos de Evento) + B12 (edição de Locais) (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.b11b12-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - B11/B12)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  // ================= B11 — Tipos de Evento =================

  await t.test("GET /tipos-evento sem autenticação → 401", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento`);
    assert.equal(res.status, 401);
  });

  await t.test("POST /tipos-evento — nome vazio → 400", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(res.status, 400);
  });

  let typeId;
  await t.test("POST /tipos-evento — cria com sucesso (201)", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: TAG + "Casamento" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.name, TAG + "Casamento");
    typeId = body.id;
  });

  await t.test("GET /tipos-evento — lista inclui o criado, com contagem de eventos = 0", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento`, { headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    const row = body.find((t2) => t2.id === typeId);
    assert.ok(row, "tipo criado deveria aparecer na listagem");
    assert.equal(row.events, 0);
  });

  await t.test("DELETE /tipos-evento/:id — UUID inválido → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento/id-invalido`, { method: "DELETE", headers: { Cookie: cookie } });
    assert.equal(res.status, 400);
  });

  await t.test("DELETE /tipos-evento/:id — tipo vinculado a um evento → 409 amigável (não 500)", async () => {
    // Evento mínimo referenciando o tipo, inserido direto (só colunas
    // NOT NULL) — mesmo padrão já usado desde a Fase 2/4 para este tipo
    // de vínculo de teste.
    const eventId = randomUUID();
    await sql`insert into "Event" ${sql({
      id: eventId, code: TAG + "EVT", title: TAG + "Evento vinculado", status: "RASCUNHO",
      plannedRevenueCents: 0, actualRevenueCents: 0, plannedCostCents: 0, actualCostCents: 0,
      createdAt: new Date(), updatedAt: new Date(), eventTypeId: typeId,
    })}`;

    const res = await fetch(`${baseUrl}/api/tipos-evento/${typeId}`, { method: "DELETE", headers: { Cookie: cookie } });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.match(body.error, /vinculado|eventos/i);

    await sql`delete from "Event" where id = ${eventId}`;
  });

  await t.test("DELETE /tipos-evento/:id — sem vínculo → 200", async () => {
    const res = await fetch(`${baseUrl}/api/tipos-evento/${typeId}`, { method: "DELETE", headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const leftover = await sql`select id from "EventType" where id = ${typeId}`;
    assert.equal(leftover.length, 0);
  });

  // ================= B12 — Edição de Locais =================

  let venueId;
  await t.test("POST /locais — cria local de teste", async () => {
    const res = await fetch(`${baseUrl}/api/locais`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: TAG + "Local Original", city: "Teresina", state: "PI" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    venueId = body.id;
  });

  await t.test("PUT /locais/:id — nome vazio → 400", async () => {
    const res = await fetch(`${baseUrl}/api/locais/${venueId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "  " }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("PUT /locais/:id — UUID inválido → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/locais/id-invalido`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("PUT /locais/:id — local inexistente (UUID válido) → 404", async () => {
    const res = await fetch(`${baseUrl}/api/locais/${FAKE_ID}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(res.status, 404);
  });

  await t.test("PUT /locais/:id — edita com sucesso, e os dados editados aparecem na listagem", async () => {
    const res = await fetch(`${baseUrl}/api/locais/${venueId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: TAG + "Local Editado", city: "Parnaíba", state: "PI",
        address: "Rua das Flores, 123", capacity: "250", isOwn: true, notes: "Editado pelo teste",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.name, TAG + "Local Editado");
    assert.equal(body.city, "Parnaíba");
    assert.equal(body.capacity, 250);
    assert.equal(body.isOwn, true);

    const list = await fetch(`${baseUrl}/api/locais`, { headers: { Cookie: cookie } });
    const rows = await list.json();
    const row = rows.find((v) => v.id === venueId);
    assert.ok(row, "local editado deveria continuar na listagem");
    assert.equal(row.name, TAG + "Local Editado");
    assert.equal(row.city, "Parnaíba");
  });

  await t.test("limpeza — remove o local de teste e confirma zero resíduo AUDIT-FASE5-B11B12-*", async () => {
    await sql`delete from "Venue" where id = ${venueId}`;
    const leftoverVenue = await sql`select id from "Venue" where name like ${TAG + "%"}`;
    const leftoverType = await sql`select id from "EventType" where name like ${TAG + "%"}`;
    const leftoverEvent = await sql`select id from "Event" where title like ${TAG + "%"}`;
    assert.equal(leftoverVenue.length, 0, "Venue");
    assert.equal(leftoverType.length, 0, "EventType");
    assert.equal(leftoverEvent.length, 0, "Event");
  });
});
