// Fase 5 / Lote 4 — achado B16: padronização das rotas DELETE. Antes, 19
// das 20 rotas de exclusão eram "idempotentes" (sempre 200, mesmo se o id
// nunca existiu) — só server/routes/usuarios.js verificava existência e
// devolvia 404. Agora as 19 seguem o mesmo padrão (referência a
// server/routes/usuarios.js): `DELETE ... RETURNING id` + 404 se nada foi
// apagado. Onde já existia tratamento de FK (409), ele foi preservado.
//
// Estratégia de teste: para cada entidade, cria um registro real, exclui
// (200 — prova que o caminho feliz continua funcionando) e tenta excluir
// de novo o MESMO id (404 — agora que o registro não existe mais). Isso
// cobre as duas pontas com o mínimo de fixtures. Dependências são criadas
// na ordem certa e só removidas depois de todos os seus dependentes.
//
// Banco real, servidor Express real, dados "AUDIT-FASE5-B16-*", removidos
// ao final. Pula graciosamente se não houver conexão com o banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { clientesRouter } from "../routes/clientes.js";
import { eventosRouter, locaisRouter, tiposEventoRouter } from "../routes/eventos.js";
import { catalogoRouter } from "../routes/catalogo.js";
import { fornecedoresRouter } from "../routes/fornecedores.js";
import { leadsRouter } from "../routes/leads.js";
import { oportunidadesRouter } from "../routes/oportunidades.js";
import { orcamentosRouter } from "../routes/orcamentos.js";
import { contratosRouter } from "../routes/contratos.js";
import { operacionalRouter } from "../routes/operacional.js";
import { financeiroRouter } from "../routes/financeiro.js";

const TAG = "AUDIT-FASE5-B16-";
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
  app.use("/api/clientes", clientesRouter);
  app.use("/api/eventos", eventosRouter);
  app.use("/api/locais", locaisRouter);
  app.use("/api/tipos-evento", tiposEventoRouter);
  app.use("/api/catalogo", catalogoRouter);
  app.use("/api/fornecedores", fornecedoresRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/oportunidades", oportunidadesRouter);
  app.use("/api/orcamentos", orcamentosRouter);
  app.use("/api/contratos", contratosRouter);
  app.use("/api/operacional", operacionalRouter);
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

test("B16 — DELETE em recurso inexistente → 404 em todas as rotas padronizadas (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.b16-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - B16)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  async function api(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method, headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { status: res.status, body: data };
  }

  // Testa criar → excluir (200) → excluir de novo o mesmo id (404).
  async function testDeleteTwice(name, createFn, deletePath) {
    await t.test(`${name} — excluir existente → 200, excluir de novo → 404`, async () => {
      const id = await createFn();
      const first = await api("DELETE", deletePath(id));
      assert.equal(first.status, 200, `primeira exclusão de ${name} deveria funcionar`);
      const second = await api("DELETE", deletePath(id));
      assert.equal(second.status, 404, `segunda exclusão de ${name} (id já não existe) deveria dar 404`);
      assert.match(second.body.error, /não encontrad/i);
    });
  }

  // ---- Fixtures compartilhadas: 1 Client + 1 Event ----
  const clientRes = await api("POST", "/api/clientes", { name: TAG + "Cliente" });
  assert.equal(clientRes.status, 201);
  const clientId = clientRes.body.id;

  const eventRes = await api("POST", "/api/eventos", { title: TAG + "Evento", clientId });
  assert.equal(eventRes.status, 201);
  const eventId = eventRes.body.id;

  // ---- Entidades simples, sem dependência ----
  await testDeleteTwice("Categoria", async () => {
    const r = await api("POST", "/api/catalogo/categorias", { name: TAG + "Categoria" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/catalogo/categorias/${id}`);

  await testDeleteTwice("Tipo de evento", async () => {
    const r = await api("POST", "/api/tipos-evento", { name: TAG + "Tipo" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/tipos-evento/${id}`);

  await testDeleteTwice("Local", async () => {
    const r = await api("POST", "/api/locais", { name: TAG + "Local" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/locais/${id}`);

  await testDeleteTwice("Lead", async () => {
    const r = await api("POST", "/api/leads", { name: TAG + "Lead" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/leads/${id}`);

  // ---- Contato (depende do Client compartilhado) ----
  await testDeleteTwice("Contato", async () => {
    const r = await api("POST", `/api/clientes/${clientId}/contatos`, { name: TAG + "Contato" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/clientes/contatos/${id}`);

  // ---- Oportunidade, Orçamento, Contrato (dependem do Client) ----
  await testDeleteTwice("Oportunidade", async () => {
    const r = await api("POST", "/api/oportunidades", { title: TAG + "Oportunidade", clientId });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/oportunidades/${id}`);

  await testDeleteTwice("Orçamento", async () => {
    const r = await api("POST", "/api/orcamentos", { clientId, items: [] });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/orcamentos/${id}`);

  await testDeleteTwice("Contrato", async () => {
    const r = await api("POST", "/api/contratos", { clientId, value: "100,00" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/contratos/${id}`);

  // ---- Financeiro ----
  await testDeleteTwice("Conta a receber", async () => {
    const r = await api("POST", "/api/financeiro/receber", { description: TAG + "Receber", amount: "10,00" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/financeiro/receber/${id}`);

  await testDeleteTwice("Conta a pagar", async () => {
    const r = await api("POST", "/api/financeiro/pagar", { description: TAG + "Pagar", amount: "10,00" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/financeiro/pagar/${id}`);

  // ---- Operacional (dependem do Event compartilhado) ----
  await testDeleteTwice("Tarefa", async () => {
    const r = await api("POST", "/api/operacional/tarefas", { eventId, title: TAG + "Tarefa" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/operacional/tarefas/${id}`);

  await testDeleteTwice("Item de cronograma", async () => {
    const r = await api("POST", "/api/operacional/cronograma", { eventId, title: TAG + "Agenda", startsAt: "2026-12-01T10:00:00" });
    assert.equal(r.status, 201);
    return r.body.id;
  }, (id) => `/api/operacional/cronograma/${id}`);

  // ChecklistItem antes do Checklist (o item depende do checklist existir).
  await t.test("Checklist + Item — excluir item (200/404) e depois o checklist (200/404)", async () => {
    const checklistRes = await api("POST", "/api/operacional/checklists", { eventId, title: TAG + "Checklist" });
    assert.equal(checklistRes.status, 201);
    const checklistId = checklistRes.body.id;

    const itemRes = await api("POST", `/api/operacional/checklists/${checklistId}/itens`, { label: TAG + "Item" });
    assert.equal(itemRes.status, 201);
    const itemId = itemRes.body.id;

    const delItem1 = await api("DELETE", `/api/operacional/checklists/itens/${itemId}`);
    assert.equal(delItem1.status, 200);
    const delItem2 = await api("DELETE", `/api/operacional/checklists/itens/${itemId}`);
    assert.equal(delItem2.status, 404);

    const delChecklist1 = await api("DELETE", `/api/operacional/checklists/${checklistId}`);
    assert.equal(delChecklist1.status, 200);
    const delChecklist2 = await api("DELETE", `/api/operacional/checklists/${checklistId}`);
    assert.equal(delChecklist2.status, 404);
  });

  // ---- Catálogo: Fornecedor + Produto + vínculo (ordem importa: o
  // vínculo bloqueia a exclusão do Produto/Fornecedor via FK — Fase 4) ----
  await t.test("Vínculo fornecedor↔item, depois Produto, depois Fornecedor — 200/404 em cada", async () => {
    const supplierRes = await api("POST", "/api/fornecedores", { name: TAG + "Fornecedor" });
    assert.equal(supplierRes.status, 201);
    const supplierId = supplierRes.body.id;

    const productRes = await api("POST", "/api/catalogo", { name: TAG + "Produto" });
    assert.equal(productRes.status, 201);
    const productId = productRes.body.id;

    const linkRes = await api("POST", `/api/catalogo/${productId}/fornecedores`, { supplierId, cost: "10,00" });
    assert.equal(linkRes.status, 201);
    const linkId = linkRes.body.id;

    const delLink1 = await api("DELETE", `/api/catalogo/fornecedores/${linkId}`);
    assert.equal(delLink1.status, 200);
    const delLink2 = await api("DELETE", `/api/catalogo/fornecedores/${linkId}`);
    assert.equal(delLink2.status, 404);

    const delProduct1 = await api("DELETE", `/api/catalogo/${productId}`);
    assert.equal(delProduct1.status, 200, "vínculo já removido — Produto deveria excluir normalmente");
    const delProduct2 = await api("DELETE", `/api/catalogo/${productId}`);
    assert.equal(delProduct2.status, 404);

    const delSupplier1 = await api("DELETE", `/api/fornecedores/${supplierId}`);
    assert.equal(delSupplier1.status, 200);
    const delSupplier2 = await api("DELETE", `/api/fornecedores/${supplierId}`);
    assert.equal(delSupplier2.status, 404);
  });

  // ---- Reconfirmação: FK ainda bloqueia com 409 (não regrediu para 404 nem 500) ----
  await t.test("Reconfirmação: exclusão bloqueada por FK continua 409 (não virou 404 nem 500)", async () => {
    // O Client compartilhado ainda tem o Event vinculado (só será excluído
    // no bloco seguinte) — tentar excluir o Client agora deve continuar
    // dando 409 por FK, não 404.
    const res = await api("DELETE", `/api/clientes/${clientId}`);
    assert.equal(res.status, 409, "cliente com evento vinculado deveria continuar bloqueado por FK, não 404");
  });

  // ---- Por último: Event e Client compartilhados (agora sem dependentes) ----
  await t.test("Evento e Cliente compartilhados — excluir (200/404) ao final, sem dependentes", async () => {
    const delEvent1 = await api("DELETE", `/api/eventos/${eventId}`);
    assert.equal(delEvent1.status, 200);
    const delEvent2 = await api("DELETE", `/api/eventos/${eventId}`);
    assert.equal(delEvent2.status, 404);

    const delClient1 = await api("DELETE", `/api/clientes/${clientId}`);
    assert.equal(delClient1.status, 200);
    const delClient2 = await api("DELETE", `/api/clientes/${clientId}`);
    assert.equal(delClient2.status, 404);
  });

  await t.test("limpeza — nenhum dado AUDIT-FASE5-B16-* residual", async () => {
    const like = TAG + "%";
    const [client, lead, event, venue, type, category, product, supplier, opp, receivable, payable, task, schedule, checklist] = await Promise.all([
      sql`select id from "Client" where name like ${like}`,
      sql`select id from "Lead" where name like ${like}`,
      sql`select id from "Event" where title like ${like}`,
      sql`select id from "Venue" where name like ${like}`,
      sql`select id from "EventType" where name like ${like}`,
      sql`select id from "Category" where name like ${like}`,
      sql`select id from "ProductService" where name like ${like}`,
      sql`select id from "Supplier" where name like ${like}`,
      sql`select id from "Opportunity" where title like ${like}`,
      sql`select id from "AccountReceivable" where description like ${like}`,
      sql`select id from "AccountPayable" where description like ${like}`,
      sql`select id from "Task" where title like ${like}`,
      sql`select id from "ScheduleItem" where title like ${like}`,
      sql`select id from "Checklist" where title like ${like}`,
    ]);
    assert.equal(client.length, 0, "Client");
    assert.equal(lead.length, 0, "Lead");
    assert.equal(event.length, 0, "Event");
    assert.equal(venue.length, 0, "Venue");
    assert.equal(type.length, 0, "EventType");
    assert.equal(category.length, 0, "Category");
    assert.equal(product.length, 0, "ProductService");
    assert.equal(supplier.length, 0, "Supplier");
    assert.equal(opp.length, 0, "Opportunity");
    assert.equal(receivable.length, 0, "AccountReceivable");
    assert.equal(payable.length, 0, "AccountPayable");
    assert.equal(task.length, 0, "Task");
    assert.equal(schedule.length, 0, "ScheduleItem");
    assert.equal(checklist.length, 0, "Checklist");
    // Budget/Contract já foram excluídos e reconfirmados via 404 explícito
    // acima (não têm campo com o prefixo para varrer por LIKE).
  });
});
