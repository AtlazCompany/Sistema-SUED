// Fase 4 — teste de regressão para um achado real da auditoria funcional:
// vários endpoints DELETE não tratavam violação de FK (Postgres 23503),
// deixando o erro cru (nome de tabela/constraint) vazar pro cliente HTTP
// como 500 — em vez de um 409 amigável, no mesmo padrão já usado por
// server/routes/usuarios.js desde a Fase 2. Corrigido em:
//   clientes.js, fornecedores.js, catalogo.js (produto e categoria),
//   eventos.js (evento e local), oportunidades.js
// Banco real, servidor Express real local, dados prefixados
// "AUDIT-FASE4-" (removidos ao final, com checagem que falha o processo
// se sobrar algum). Pula graciosamente se não houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { clientesRouter } from "../routes/clientes.js";
import { fornecedoresRouter } from "../routes/fornecedores.js";
import { catalogoRouter } from "../routes/catalogo.js";
import { eventosRouter, locaisRouter } from "../routes/eventos.js";
import { oportunidadesRouter } from "../routes/oportunidades.js";

const TAG = "AUDIT-FASE4-";
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
  app.use("/api/fornecedores", fornecedoresRouter);
  app.use("/api/catalogo", catalogoRouter);
  app.use("/api/eventos", eventosRouter);
  app.use("/api/locais", locaisRouter);
  app.use("/api/oportunidades", oportunidadesRouter);
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

async function del(path, cookie) {
  return fetch(`${baseUrl}${path}`, { method: "DELETE", headers: { Cookie: cookie } });
}

test("guardas de FK em DELETE — 409 amigável, nunca 500 com erro cru (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase4.bootstrap-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 4)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  await t.test("Cliente vinculado a um Lead → 409, e exclui depois de desvincular", async () => {
    const clientId = randomUUID();
    const leadId = randomUUID();
    await sql`insert into "Client" ${sql({ id: clientId, personType: "PF", name: TAG + "Client", createdAt: new Date(), updatedAt: new Date() })}`;
    await sql`insert into "Lead" ${sql({ id: leadId, name: TAG + "Lead", status: "NOVO", clientId, createdAt: new Date(), updatedAt: new Date() })}`;
    try {
      const res = await del(`/api/clientes/${clientId}`, cookie);
      const body = await res.json();
      assert.equal(res.status, 409);
      assert.match(body.error, /vinculado/);
      await sql`delete from "Lead" where id = ${leadId}`;
      const res2 = await del(`/api/clientes/${clientId}`, cookie);
      assert.equal(res2.status, 200);
    } finally {
      await sql`delete from "Lead" where id = ${leadId}`;
      await sql`delete from "Client" where id = ${clientId}`;
    }
  });

  await t.test("Fornecedor + Produto vinculados via SupplierProduct → ambos 409; Categoria vinculada ao Produto → 409", async () => {
    const supplierId = randomUUID();
    const categoryId = randomUUID();
    const productId = randomUUID();
    const linkId = randomUUID();
    await sql`insert into "Supplier" ${sql({ id: supplierId, name: TAG + "Supplier", createdAt: new Date(), updatedAt: new Date() })}`;
    await sql`insert into "Category" ${sql({ id: categoryId, name: TAG + "Category" })}`;
    await sql`insert into "ProductService" ${sql({
      id: productId, name: TAG + "Product", categoryId, referenceCostCents: 0, suggestedPriceCents: 0,
      active: true, createdAt: new Date(), updatedAt: new Date(),
    })}`;
    await sql`insert into "SupplierProduct" ${sql({ id: linkId, productServiceId: productId, supplierId, costCents: 0, isDefault: false })}`;
    try {
      const resSupplier = await del(`/api/fornecedores/${supplierId}`, cookie);
      assert.equal(resSupplier.status, 409);
      assert.match((await resSupplier.json()).error, /vinculado/);

      const resProduct = await del(`/api/catalogo/${productId}`, cookie);
      assert.equal(resProduct.status, 409);
      assert.match((await resProduct.json()).error, /vinculado/);

      const resCategory = await del(`/api/catalogo/categorias/${categoryId}`, cookie);
      assert.equal(resCategory.status, 409);

      // Desvincula e confirma que os três passam a excluir normalmente.
      await sql`delete from "SupplierProduct" where id = ${linkId}`;
      assert.equal((await del(`/api/fornecedores/${supplierId}`, cookie)).status, 200);
      assert.equal((await del(`/api/catalogo/${productId}`, cookie)).status, 200);
      assert.equal((await del(`/api/catalogo/categorias/${categoryId}`, cookie)).status, 200);
    } finally {
      await sql`delete from "SupplierProduct" where id = ${linkId}`;
      await sql`delete from "ProductService" where id = ${productId}`;
      await sql`delete from "Category" where id = ${categoryId}`;
      await sql`delete from "Supplier" where id = ${supplierId}`;
    }
  });

  await t.test("Evento vinculado a uma Task → 409, e exclui depois de desvincular", async () => {
    const eventId = randomUUID();
    const taskId = randomUUID();
    await sql`insert into "Event" ${sql({
      id: eventId, code: TAG + "EVT-TASK", title: TAG + "Event (task)", status: "RASCUNHO",
      plannedRevenueCents: 0, actualRevenueCents: 0, plannedCostCents: 0, actualCostCents: 0,
      createdAt: new Date(), updatedAt: new Date(),
    })}`;
    await sql`insert into "Task" ${sql({
      id: taskId, eventId, title: TAG + "Task", status: "A_FAZER", priority: "MEDIA",
      createdAt: new Date(), updatedAt: new Date(),
    })}`;
    try {
      const res = await del(`/api/eventos/${eventId}`, cookie);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /vinculado/);
      await sql`delete from "Task" where id = ${taskId}`;
      assert.equal((await del(`/api/eventos/${eventId}`, cookie)).status, 200);
    } finally {
      await sql`delete from "Task" where id = ${taskId}`;
      await sql`delete from "Event" where id = ${eventId}`;
    }
  });

  await t.test("Local vinculado a um Evento → 409, e exclui depois de desvincular", async () => {
    const venueId = randomUUID();
    const eventId = randomUUID();
    await sql`insert into "Venue" ${sql({ id: venueId, name: TAG + "Venue", isOwn: false, createdAt: new Date() })}`;
    await sql`insert into "Event" ${sql({
      id: eventId, code: TAG + "EVT-VENUE", title: TAG + "Event (venue)", status: "RASCUNHO", venueId,
      plannedRevenueCents: 0, actualRevenueCents: 0, plannedCostCents: 0, actualCostCents: 0,
      createdAt: new Date(), updatedAt: new Date(),
    })}`;
    try {
      const res = await del(`/api/locais/${venueId}`, cookie);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /vinculado/);
      await sql`delete from "Event" where id = ${eventId}`;
      assert.equal((await del(`/api/locais/${venueId}`, cookie)).status, 200);
    } finally {
      await sql`delete from "Event" where id = ${eventId}`;
      await sql`delete from "Venue" where id = ${venueId}`;
    }
  });

  await t.test("Oportunidade vinculada a um Evento → 409, e exclui depois de desvincular", async () => {
    const clientId = randomUUID();
    const opportunityId = randomUUID();
    const eventId = randomUUID();
    await sql`insert into "Client" ${sql({ id: clientId, personType: "PF", name: TAG + "Client (opp)", createdAt: new Date(), updatedAt: new Date() })}`;
    await sql`insert into "Opportunity" ${sql({
      id: opportunityId, title: TAG + "Opportunity", clientId, stage: "PROSPECCAO", estimatedCents: 0,
      createdAt: new Date(), updatedAt: new Date(),
    })}`;
    await sql`insert into "Event" ${sql({
      id: eventId, code: TAG + "EVT-OPP", title: TAG + "Event (opp)", status: "RASCUNHO", opportunityId,
      plannedRevenueCents: 0, actualRevenueCents: 0, plannedCostCents: 0, actualCostCents: 0,
      createdAt: new Date(), updatedAt: new Date(),
    })}`;
    try {
      const res = await del(`/api/oportunidades/${opportunityId}`, cookie);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /vinculada/);
      await sql`delete from "Event" where id = ${eventId}`;
      assert.equal((await del(`/api/oportunidades/${opportunityId}`, cookie)).status, 200);
    } finally {
      await sql`delete from "Event" where id = ${eventId}`;
      await sql`delete from "Opportunity" where id = ${opportunityId}`;
      await sql`delete from "Client" where id = ${clientId}`;
    }
  });

  await t.test("limpeza — nenhum dado AUDIT-FASE4-* residual desta suíte", async () => {
    const like = TAG + "%";
    const [lead, client, product, category, supplier, task, event, venue, opportunity] = await Promise.all([
      sql`select id from "Lead" where name like ${like}`,
      sql`select id from "Client" where name like ${like}`,
      sql`select id from "ProductService" where name like ${like}`,
      sql`select id from "Category" where name like ${like}`,
      sql`select id from "Supplier" where name like ${like}`,
      sql`select id from "Task" where title like ${like}`,
      sql`select id from "Event" where title like ${like}`,
      sql`select id from "Venue" where name like ${like}`,
      sql`select id from "Opportunity" where title like ${like}`,
    ]);
    assert.equal(lead.length, 0, "Lead");
    assert.equal(client.length, 0, "Client");
    assert.equal(product.length, 0, "ProductService");
    assert.equal(category.length, 0, "Category");
    assert.equal(supplier.length, 0, "Supplier");
    assert.equal(task.length, 0, "Task");
    assert.equal(event.length, 0, "Event");
    assert.equal(venue.length, 0, "Venue");
    assert.equal(opportunity.length, 0, "Opportunity");
  });
});
