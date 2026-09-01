// Fase 5 / Lote 1 — achado B1: rotas POST/PUT que aceitam uma referência
// (FK) a outro registro (clientId, eventId, ownerId, assigneeId,
// supplierId, productServiceId, categoryId, checklistId, venueId,
// eventTypeId, opportunityId, commercialId, operationalId) não tratavam a
// violação de FK do Postgres (23503) — um valor apontando pra um registro
// inexistente vazava um 500 com a mensagem crua do driver. Corrigido com o
// MESMO padrão já usado e testado nas rotas DELETE desde a Fase 4
// (fk-delete-guards.test.js), agora aplicado nas rotas de escrita.
//
// Banco real, servidor Express real local, dados prefixados
// "AUDIT-FASE5-" (removidos ao final, com checagem que falha o processo se
// sobrar algum). Pula graciosamente se não houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { eventosRouter, locaisRouter } from "../routes/eventos.js";
import { oportunidadesRouter } from "../routes/oportunidades.js";
import { orcamentosRouter } from "../routes/orcamentos.js";
import { contratosRouter } from "../routes/contratos.js";
import { operacionalRouter } from "../routes/operacional.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { catalogoRouter } from "../routes/catalogo.js";

const TAG = "AUDIT-FASE5-";
const FAKE_ID = "00000000-0000-0000-0000-000000000000"; // UUID válido, garantidamente inexistente
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;

try {
  sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 5, connect_timeout: 5 });
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
  app.use("/api/oportunidades", oportunidadesRouter);
  app.use("/api/orcamentos", orcamentosRouter);
  app.use("/api/contratos", contratosRouter);
  app.use("/api/operacional", operacionalRouter);
  app.use("/api/financeiro", financeiroRouter);
  app.use("/api/catalogo", catalogoRouter);
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

function apiAs(cookie) {
  return async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { status: res.status, body: data };
  };
}

test("guardas de FK em rotas de escrita (POST/PUT) — 400 amigável, nunca 500 com erro cru (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.bootstrap-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const A = apiAs(cookie);

  // ---- Fixtures válidas (inserção direta, mesmo padrão de
  // fk-delete-guards.test.js) — usadas como valores VÁLIDOS de controle
  // enquanto um campo por vez é quebrado em cada subteste.
  const clientId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const supplierId = randomUUID();
  await sql`insert into "Client" ${sql({ id: clientId, personType: "PF", name: TAG + "Client", createdAt: new Date(), updatedAt: new Date() })}`;
  await sql`insert into "Category" ${sql({ id: categoryId, name: TAG + "Category" })}`;
  await sql`insert into "ProductService" ${sql({
    id: productId, name: TAG + "Product", categoryId, referenceCostCents: 0, suggestedPriceCents: 0,
    active: true, createdAt: new Date(), updatedAt: new Date(),
  })}`;
  await sql`insert into "Supplier" ${sql({ id: supplierId, name: TAG + "Supplier", createdAt: new Date(), updatedAt: new Date() })}`;
  const createdIds = { clients: [clientId], categories: [categoryId], products: [productId], suppliers: [supplierId], events: [], opportunities: [], budgets: [], contracts: [], tasks: [], checklists: [] };

  // ---- Eventos ----
  await t.test("POST /eventos — clientId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/eventos", { title: TAG + "Evento inválido", clientId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let eventId;
  await t.test("POST /eventos — todos os IDs válidos → 201 (confirma que o tratamento de erro não quebrou o caminho normal)", async () => {
    const res = await A("POST", "/api/eventos", { title: TAG + "Evento", clientId });
    assert.equal(res.status, 201);
    eventId = res.body.id;
    createdIds.events.push(eventId);
  });

  await t.test("PUT /eventos/:id — venueId inexistente → 400 (não 500)", async () => {
    const res = await A("PUT", `/api/eventos/${eventId}`, { title: TAG + "Evento", clientId, venueId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("DELETE /locais/:id com UUID inválido segue 400 (reconfirmação — não regredido)", async () => {
    const res = await A("DELETE", "/api/locais/nao-e-um-uuid");
    assert.equal(res.status, 400);
  });

  // ---- Oportunidades ----
  await t.test("POST /oportunidades — clientId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/oportunidades", { title: TAG + "Oportunidade inválida", clientId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let opportunityId;
  await t.test("POST /oportunidades — clientId válido → 201", async () => {
    const res = await A("POST", "/api/oportunidades", { title: TAG + "Oportunidade", clientId });
    assert.equal(res.status, 201);
    opportunityId = res.body.id;
    createdIds.opportunities.push(opportunityId);
  });

  await t.test("PUT /oportunidades/:id — ownerId inexistente → 400 (não 500)", async () => {
    const res = await A("PUT", `/api/oportunidades/${opportunityId}`, { title: TAG + "Oportunidade", clientId, ownerId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // Achado B19 (Fase 5, releitura técnica): mesma classe de problema do
  // B1, mas com a referência quebrada vindo do PARÂMETRO DE ROTA (:id), não
  // do corpo — por isso ficou fora do inventário original do B1.
  await t.test("POST /oportunidades/:id/interacoes — opportunityId (na URL) inexistente → 400 (não 500) [achado B19]", async () => {
    const res = await A("POST", `/api/oportunidades/${FAKE_ID}/interacoes`, { content: TAG + "Interação inválida" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /oportunidades/:id/interacoes — opportunityId válido → 201 (confirma que o caminho normal não quebrou)", async () => {
    const res = await A("POST", `/api/oportunidades/${opportunityId}/interacoes`, { content: TAG + "Interação" });
    assert.equal(res.status, 201);
    assert.equal(res.body.content, TAG + "Interação");
  });

  // ---- Orçamentos ----
  await t.test("POST /orcamentos — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/orcamentos", { clientId, eventId: FAKE_ID, items: [] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /orcamentos — items[].productServiceId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/orcamentos", {
      clientId, items: [{ productServiceId: FAKE_ID, description: TAG + "Item inválido", quantity: 1, unitPrice: "10,00" }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let budgetId;
  await t.test("POST /orcamentos — clientId + item válidos → 201", async () => {
    const res = await A("POST", "/api/orcamentos", {
      clientId, items: [{ productServiceId: productId, description: TAG + "Item", quantity: 1, unitPrice: "10,00" }],
    });
    assert.equal(res.status, 201);
    budgetId = res.body.id;
    createdIds.budgets.push(budgetId);
  });

  await t.test("PUT /orcamentos/:id — clientId inexistente → 400 (não 500)", async () => {
    const res = await A("PUT", `/api/orcamentos/${budgetId}`, { clientId: FAKE_ID, items: [] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // ---- Contratos ----
  await t.test("POST /contratos — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/contratos", { clientId, eventId: FAKE_ID, value: "100,00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let contractId;
  await t.test("POST /contratos — clientId válido → 201", async () => {
    const res = await A("POST", "/api/contratos", { clientId, value: "100,00" });
    assert.equal(res.status, 201);
    contractId = res.body.id;
    createdIds.contracts.push(contractId);
  });

  await t.test("PUT /contratos/:id — clientId inexistente → 400 (não 500)", async () => {
    const res = await A("PUT", `/api/contratos/${contractId}`, { clientId: FAKE_ID, value: "100,00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // ---- Operacional ----
  await t.test("POST /operacional/tarefas — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/operacional/tarefas", { eventId: FAKE_ID, title: TAG + "Tarefa inválida" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let taskId;
  await t.test("POST /operacional/tarefas — eventId válido → 201", async () => {
    const res = await A("POST", "/api/operacional/tarefas", { eventId, title: TAG + "Tarefa" });
    assert.equal(res.status, 201);
    taskId = res.body.id;
    createdIds.tasks.push(taskId);
  });

  await t.test("PATCH /operacional/tarefas/:id — assigneeId inexistente → 400 (não 500)", async () => {
    const res = await A("PATCH", `/api/operacional/tarefas/${taskId}`, { assigneeId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /operacional/checklists — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/operacional/checklists", { eventId: FAKE_ID, title: TAG + "Checklist inválido" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  let checklistId;
  await t.test("POST /operacional/checklists — eventId válido → 201", async () => {
    const res = await A("POST", "/api/operacional/checklists", { eventId, title: TAG + "Checklist" });
    assert.equal(res.status, 201);
    checklistId = res.body.id;
    createdIds.checklists.push(checklistId);
  });

  await t.test("POST /operacional/checklists/:id/itens — checklistId (na URL) inexistente → 400 (não 500)", async () => {
    const res = await A("POST", `/api/operacional/checklists/${FAKE_ID}/itens`, { label: TAG + "Item inválido" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /operacional/cronograma — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/operacional/cronograma", { eventId: FAKE_ID, title: TAG + "Cronograma inválido", startsAt: "2026-12-01T10:00:00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // ---- Financeiro ----
  await t.test("POST /financeiro/receber — eventId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/financeiro/receber", { description: TAG + "Conta a receber inválida", eventId: FAKE_ID, amount: "10,00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /financeiro/pagar — supplierId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/financeiro/pagar", { description: TAG + "Conta a pagar inválida", supplierId: FAKE_ID, amount: "10,00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // ---- Catálogo ----
  await t.test("POST /catalogo — categoryId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", "/api/catalogo", { name: TAG + "Produto inválido", categoryId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("PUT /catalogo/:id — categoryId inexistente → 400 (não 500)", async () => {
    const res = await A("PUT", `/api/catalogo/${productId}`, { name: TAG + "Product", categoryId: FAKE_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  await t.test("POST /catalogo/:id/fornecedores — supplierId inexistente → 400 (não 500)", async () => {
    const res = await A("POST", `/api/catalogo/${productId}/fornecedores`, { supplierId: FAKE_ID, cost: "10,00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /não existe mais/);
  });

  // ---- Limpeza ----
  await t.test("limpeza — nenhum dado AUDIT-FASE5-* residual desta suíte", async () => {
    await sql`delete from "ChecklistItem" where "checklistId" in ${sql(createdIds.checklists.length ? createdIds.checklists : [FAKE_ID])}`;
    await sql`delete from "Checklist" where id in ${sql(createdIds.checklists.length ? createdIds.checklists : [FAKE_ID])}`;
    await sql`delete from "Task" where id in ${sql(createdIds.tasks.length ? createdIds.tasks : [FAKE_ID])}`;
    await sql`delete from "BudgetItem" where "budgetId" in ${sql(createdIds.budgets.length ? createdIds.budgets : [FAKE_ID])}`;
    await sql`delete from "Budget" where id in ${sql(createdIds.budgets.length ? createdIds.budgets : [FAKE_ID])}`;
    await sql`delete from "Contract" where id in ${sql(createdIds.contracts.length ? createdIds.contracts : [FAKE_ID])}`;
    await sql`delete from "Event" where id in ${sql(createdIds.events.length ? createdIds.events : [FAKE_ID])}`;
    // A interação criada no teste do achado B19 referencia a oportunidade — precisa sair primeiro (FK).
    await sql`delete from "Interaction" where "opportunityId" in ${sql(createdIds.opportunities.length ? createdIds.opportunities : [FAKE_ID])}`;
    await sql`delete from "Opportunity" where id in ${sql(createdIds.opportunities.length ? createdIds.opportunities : [FAKE_ID])}`;
    await sql`delete from "SupplierProduct" where "productServiceId" in ${sql(createdIds.products)}  or "supplierId" in ${sql(createdIds.suppliers)}`;
    await sql`delete from "ProductService" where id in ${sql(createdIds.products)}`;
    await sql`delete from "Category" where id in ${sql(createdIds.categories)}`;
    await sql`delete from "Supplier" where id in ${sql(createdIds.suppliers)}`;
    await sql`delete from "Client" where id in ${sql(createdIds.clients)}`;

    // Verificação por padrão de nome/título (cobre qualquer linha
    // AUDIT-FASE5-* que porventura não estivesse em createdIds).
    const like = TAG + "%";
    const [client, product, category, supplier, event, opportunity, task, checklist, interaction] = await Promise.all([
      sql`select id from "Client" where name like ${like}`,
      sql`select id from "ProductService" where name like ${like}`,
      sql`select id from "Category" where name like ${like}`,
      sql`select id from "Supplier" where name like ${like}`,
      sql`select id from "Event" where title like ${like}`,
      sql`select id from "Opportunity" where title like ${like}`,
      sql`select id from "Task" where title like ${like}`,
      sql`select id from "Checklist" where title like ${like}`,
      sql`select id from "Interaction" where content like ${like}`,
    ]);
    assert.equal(client.length, 0, "Client");
    assert.equal(product.length, 0, "ProductService");
    assert.equal(category.length, 0, "Category");
    assert.equal(supplier.length, 0, "Supplier");
    assert.equal(event.length, 0, "Event");
    assert.equal(opportunity.length, 0, "Opportunity");
    assert.equal(task.length, 0, "Task");
    assert.equal(checklist.length, 0, "Checklist");
    assert.equal(interaction.length, 0, "Interaction");

    // Budget e Contract não têm um campo com o prefixo AUDIT-FASE5 (o item
    // de orçamento tem "description", mas o cabeçalho e o contrato, não) —
    // verificados pelos ids explicitamente rastreados em createdIds, já
    // apagados acima.
    if (createdIds.budgets.length) {
      const leftoverBudgets = await sql`select id from "Budget" where id in ${sql(createdIds.budgets)}`;
      assert.equal(leftoverBudgets.length, 0, "Budget (por id rastreado)");
    }
    if (createdIds.contracts.length) {
      const leftoverContracts = await sql`select id from "Contract" where id in ${sql(createdIds.contracts)}`;
      assert.equal(leftoverContracts.length, 0, "Contract (por id rastreado)");
    }
  });
});
