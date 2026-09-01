// Fase 5 / Lote 8 — decisões de regra de negócio do usuário, antes
// congeladas aguardando o consultor, agora decididas e implementadas:
//
//   B2  — transição de status/estágio só avança (Evento, Oportunidade,
//         Orçamento, Contrato); cada módulo tem uma saída definitiva
//         (CANCELADO/PERDIDO/REJEITADO/EXPIRADO) alcançável a qualquer
//         momento antes do fim; depois de um status terminal, nenhuma
//         mudança.
//   B3  — Cliente não pode ter documento (CPF/CNPJ) duplicado (índice
//         único condicional no banco — permite vários sem documento).
//   B4  — Financeiro não aceita valor <= 0 em contas a pagar/receber.
//   B5  — Orçamento não aceita desconto maior que o subtotal dos itens.
//   B18 — "vigente": aprovar um Orçamento (ou assinar um Contrato)
//         desmarca automaticamente qualquer outro do MESMO evento.
//
// Banco real, servidor Express real local, dados "AUDIT-FASE5-*"
// (removidos ao final). Pula graciosamente se não houver banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { clientesRouter } from "../routes/clientes.js";
import { eventosRouter } from "../routes/eventos.js";
import { oportunidadesRouter } from "../routes/oportunidades.js";
import { orcamentosRouter } from "../routes/orcamentos.js";
import { contratosRouter } from "../routes/contratos.js";
import { financeiroRouter } from "../routes/financeiro.js";

const TAG = "AUDIT-FASE5-B2B18-";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;
const createdIds = { clients: [], events: [], opportunities: [], budgets: [], contracts: [], receivables: [] };

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
  app.use("/api/clientes", clientesRouter);
  app.use("/api/eventos", eventosRouter);
  app.use("/api/oportunidades", oportunidadesRouter);
  app.use("/api/orcamentos", orcamentosRouter);
  app.use("/api/contratos", contratosRouter);
  app.use("/api/financeiro", financeiroRouter);
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

test("regras de negócio B2/B3/B4/B5/B18 (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.b2b18-bootstrap@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - B2/B18)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const A = apiAs(cookie);

  // ---- B2: Evento ----
  await t.test("B2 Evento — avançar pulando etapas é permitido", async () => {
    const res = await A("POST", "/api/eventos", { title: TAG + "Evento1" });
    assert.equal(res.status, 201);
    createdIds.events.push(res.body.id);
    const r = await A("PUT", `/api/eventos/${res.body.id}`, { title: TAG + "Evento1", status: "CONFIRMADO" });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "CONFIRMADO");
  });

  await t.test("B2 Evento — voltar status é bloqueado (400)", async () => {
    const id = createdIds.events[0];
    const r = await A("PUT", `/api/eventos/${id}`, { title: TAG + "Evento1", status: "RASCUNHO" });
    assert.equal(r.status, 400);
  });

  await t.test("B2 Evento — REALIZADO → POS_EVENTO permitido", async () => {
    const id = createdIds.events[0];
    await A("PUT", `/api/eventos/${id}`, { title: TAG + "Evento1", status: "REALIZADO" });
    const r = await A("PUT", `/api/eventos/${id}`, { title: TAG + "Evento1", status: "POS_EVENTO" });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "POS_EVENTO");
  });

  await t.test("B2 Evento — POS_EVENTO é definitivo, nenhuma mudança depois", async () => {
    const id = createdIds.events[0];
    const r = await A("PUT", `/api/eventos/${id}`, { title: TAG + "Evento1", status: "CANCELADO" });
    assert.equal(r.status, 400);
  });

  await t.test("B2 Evento — CANCELADO permitido a partir de um status ativo", async () => {
    const res = await A("POST", "/api/eventos", { title: TAG + "Evento2" });
    createdIds.events.push(res.body.id);
    const r = await A("PUT", `/api/eventos/${res.body.id}`, { title: TAG + "Evento2", status: "CANCELADO" });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "CANCELADO");
  });

  // ---- B2: Oportunidade ----
  await t.test("B2 Oportunidade — cliente + oportunidade, avançar estágio pulando é permitido", async () => {
    const client = await A("POST", "/api/clientes", { name: TAG + "ClienteOpp" });
    createdIds.clients.push(client.body.id);
    const opp = await A("POST", "/api/oportunidades", { title: TAG + "Opp1", clientId: client.body.id });
    createdIds.opportunities.push(opp.body.id);
    const r = await A("PATCH", `/api/oportunidades/${opp.body.id}/estagio`, { stage: "NEGOCIACAO" });
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, "NEGOCIACAO");
  });

  await t.test("B2 Oportunidade — voltar estágio via PATCH é bloqueado", async () => {
    const id = createdIds.opportunities[0];
    const r = await A("PATCH", `/api/oportunidades/${id}/estagio`, { stage: "PROSPECCAO" });
    assert.equal(r.status, 400);
  });

  await t.test("B2 Oportunidade — voltar estágio via PUT geral também é bloqueado (não é brecha)", async () => {
    const id = createdIds.opportunities[0];
    const client = createdIds.clients[0];
    const r = await A("PUT", `/api/oportunidades/${id}`, { title: TAG + "Opp1", clientId: client, stage: "QUALIFICACAO" });
    assert.equal(r.status, 400);
  });

  await t.test("B2 Oportunidade — GANHO é definitivo, não pode virar PERDIDO depois", async () => {
    const id = createdIds.opportunities[0];
    const ganho = await A("PATCH", `/api/oportunidades/${id}/estagio`, { stage: "GANHO" });
    assert.equal(ganho.status, 200);
    const r = await A("PATCH", `/api/oportunidades/${id}/estagio`, { stage: "PERDIDO" });
    assert.equal(r.status, 400);
  });

  // ---- B2: Orçamento ----
  await t.test("B2 Orçamento — ENVIADO → RASCUNHO bloqueado; APROVADO é definitivo", async () => {
    const client = createdIds.clients[0];
    const orc = await A("POST", "/api/orcamentos", { clientId: client, status: "RASCUNHO", items: [] });
    createdIds.budgets.push(orc.body.id);
    await A("PUT", `/api/orcamentos/${orc.body.id}`, { clientId: client, status: "ENVIADO", items: [] });
    const voltar = await A("PUT", `/api/orcamentos/${orc.body.id}`, { clientId: client, status: "RASCUNHO", items: [] });
    assert.equal(voltar.status, 400);
    const aprovar = await A("PUT", `/api/orcamentos/${orc.body.id}`, { clientId: client, status: "APROVADO", items: [] });
    assert.equal(aprovar.status, 200);
    const depois = await A("PUT", `/api/orcamentos/${orc.body.id}`, { clientId: client, status: "ENVIADO", items: [] });
    assert.equal(depois.status, 400);
  });

  // ---- B2: Contrato ----
  await t.test("B2 Contrato — ASSINADO → RASCUNHO bloqueado; ASSINADO → CANCELADO permitido", async () => {
    const client = createdIds.clients[0];
    const ct = await A("POST", "/api/contratos", { clientId: client, status: "RASCUNHO" });
    createdIds.contracts.push(ct.body.id);
    await A("PUT", `/api/contratos/${ct.body.id}`, { clientId: client, status: "ENVIADO" });
    await A("PUT", `/api/contratos/${ct.body.id}`, { clientId: client, status: "ASSINADO" });
    const voltar = await A("PUT", `/api/contratos/${ct.body.id}`, { clientId: client, status: "RASCUNHO" });
    assert.equal(voltar.status, 400, "não deveria mais ser possível desassinar voltando pra rascunho");
    const cancelar = await A("PUT", `/api/contratos/${ct.body.id}`, { clientId: client, status: "CANCELADO" });
    assert.equal(cancelar.status, 200);
  });

  // ---- B3: documento único ----
  await t.test("B3 — documento (CPF/CNPJ) duplicado é bloqueado", async () => {
    const doc = "AUDIT-FASE5-DOC-" + randomUUID().slice(0, 8);
    const c1 = await A("POST", "/api/clientes", { name: TAG + "Doc1", document: doc });
    assert.equal(c1.status, 201);
    createdIds.clients.push(c1.body.id);
    const c2 = await A("POST", "/api/clientes", { name: TAG + "Doc2", document: doc });
    assert.equal(c2.status, 400, "segundo cliente com o mesmo documento deveria ser rejeitado");
  });

  await t.test("B3 — vários clientes sem documento (null) continuam permitidos", async () => {
    const c1 = await A("POST", "/api/clientes", { name: TAG + "SemDoc1" });
    const c2 = await A("POST", "/api/clientes", { name: TAG + "SemDoc2" });
    assert.equal(c1.status, 201);
    assert.equal(c2.status, 201);
    createdIds.clients.push(c1.body.id, c2.body.id);
  });

  // ---- B4: valor negativo/zero no Financeiro ----
  await t.test("B4 — conta a receber com valor negativo ou zero é bloqueada", async () => {
    const neg = await A("POST", "/api/financeiro/receber", { description: TAG + "Neg", amount: "-10,00" });
    assert.equal(neg.status, 400);
    const zero = await A("POST", "/api/financeiro/receber", { description: TAG + "Zero", amount: "0,00" });
    assert.equal(zero.status, 400);
    const ok = await A("POST", "/api/financeiro/receber", { description: TAG + "Ok", amount: "10,00" });
    assert.equal(ok.status, 201);
    createdIds.receivables.push(ok.body.id);
  });

  await t.test("B4 — conta a pagar com valor negativo é bloqueada", async () => {
    const neg = await A("POST", "/api/financeiro/pagar", { description: TAG + "Neg", amount: "-5,00" });
    assert.equal(neg.status, 400);
  });

  // ---- B5: desconto maior que o subtotal ----
  await t.test("B5 — desconto maior que o subtotal é bloqueado; igual ao subtotal é permitido", async () => {
    const client = createdIds.clients[0];
    const itemFn = () => ({ description: "Item", quantity: 1, unitPrice: "100,00" }); // subtotal = 10000 centavos
    const excesso = await A("POST", "/api/orcamentos", { clientId: client, discount: "150,00", items: [itemFn()] });
    assert.equal(excesso.status, 400);
    const igual = await A("POST", "/api/orcamentos", { clientId: client, discount: "100,00", items: [itemFn()] });
    assert.equal(igual.status, 201, "desconto igual ao subtotal deveria ser permitido (total zero, não negativo)");
    createdIds.budgets.push(igual.body.id);
  });

  // ---- B18: vigente ----
  await t.test("B18 — aprovar um novo Orçamento desmarca o vigente anterior do mesmo evento", async () => {
    const client = createdIds.clients[0];
    const event = await A("POST", "/api/eventos", { title: TAG + "EventoVigente" });
    createdIds.events.push(event.body.id);

    const orc1 = await A("POST", "/api/orcamentos", { clientId: client, eventId: event.body.id, status: "APROVADO", items: [] });
    createdIds.budgets.push(orc1.body.id);
    assert.equal(orc1.body.vigente, true);

    const orc2 = await A("POST", "/api/orcamentos", { clientId: client, eventId: event.body.id, status: "APROVADO", items: [] });
    createdIds.budgets.push(orc2.body.id);
    assert.equal(orc2.body.vigente, true);

    const orc1Depois = await A("GET", `/api/orcamentos/${orc1.body.id}`);
    assert.equal(orc1Depois.body.vigente, false, "o orçamento aprovado antes deveria ter deixado de ser vigente");
  });

  await t.test("B18 — assinar um novo Contrato desmarca o vigente anterior do mesmo evento", async () => {
    const client = createdIds.clients[0];
    const event = await A("POST", "/api/eventos", { title: TAG + "EventoVigenteCT" });
    createdIds.events.push(event.body.id);

    const ct1 = await A("POST", "/api/contratos", { clientId: client, eventId: event.body.id, status: "ASSINADO" });
    createdIds.contracts.push(ct1.body.id);
    assert.equal(ct1.body.vigente, true);

    const ct2 = await A("POST", "/api/contratos", { clientId: client, eventId: event.body.id, status: "ASSINADO" });
    createdIds.contracts.push(ct2.body.id);
    assert.equal(ct2.body.vigente, true);

    const ct1Depois = await A("GET", `/api/contratos/${ct1.body.id}`);
    assert.equal(ct1Depois.body.vigente, false, "o contrato assinado antes deveria ter deixado de ser vigente");
  });

  // ---- limpeza ----
  await t.test("limpeza — nenhum dado AUDIT-FASE5-B2B18-* residual", async () => {
    for (const id of createdIds.budgets) await sql`delete from "BudgetItem" where "budgetId" = ${id}`;
    for (const id of createdIds.budgets) await sql`delete from "Budget" where id = ${id}`;
    for (const id of createdIds.contracts) await sql`delete from "Contract" where id = ${id}`;
    for (const id of createdIds.receivables) await sql`delete from "AccountReceivable" where id = ${id}`;
    for (const id of createdIds.opportunities) await sql`delete from "Interaction" where "opportunityId" = ${id}`;
    for (const id of createdIds.opportunities) await sql`delete from "Opportunity" where id = ${id}`;
    for (const id of createdIds.events) await sql`delete from "Event" where id = ${id}`;
    for (const id of createdIds.clients) await sql`delete from "Client" where id = ${id}`;
    await sql`delete from "AuditLog" where "userId" = ${bootstrapId} or "userName" ilike ${"%Bootstrap Admin (Fase 5 - B2/B18)%"}`;

    const leftoverClients = await sql`select id from "Client" where name like ${TAG + "%"}`;
    const leftoverEvents = await sql`select id from "Event" where title like ${TAG + "%"}`;
    const leftoverBudgets = await sql`select id from "Budget" where id in ${sql(createdIds.budgets.length ? createdIds.budgets : ["00000000-0000-0000-0000-000000000000"])}`;
    const leftoverContracts = await sql`select id from "Contract" where id in ${sql(createdIds.contracts.length ? createdIds.contracts : ["00000000-0000-0000-0000-000000000000"])}`;
    const leftoverReceivables = await sql`select id from "AccountReceivable" where description like ${TAG + "%"}`;
    assert.equal(leftoverClients.length, 0, "Client");
    assert.equal(leftoverEvents.length, 0, "Event");
    assert.equal(leftoverBudgets.length, 0, "Budget");
    assert.equal(leftoverContracts.length, 0, "Contract");
    assert.equal(leftoverReceivables.length, 0, "AccountReceivable");
  });
});
