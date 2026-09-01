// Fase 5 — achado B9 (trilha de auditoria técnica). Escopo autorizado
// explicitamente pelo usuário: só Financeiro, Contratos e Usuários — os
// outros módulos NÃO devem gerar registro em "AuditLog" (confirmado num
// subteste dedicado, usando Leads como representante). `passwordHash`
// nunca pode aparecer em nenhum registro de auditoria de "User" — sem
// exceção, testado explicitamente.
//
// Banco real, servidor Express real local, dados prefixados
// "AUDIT-FASE5-" (removidos ao final, incluindo os próprios registros de
// "AuditLog" gerados pelo teste — retenção indefinida vale para dado real,
// não para resíduo de teste). Pula graciosamente se não houver conexão.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { contratosRouter } from "../routes/contratos.js";
import { usuariosRouter } from "../routes/usuarios.js";
import { leadsRouter } from "../routes/leads.js";

const TAG = "AUDIT-FASE5-B9-";
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
  app.use("/api/financeiro", financeiroRouter);
  app.use("/api/contratos", contratosRouter);
  app.use("/api/usuarios", usuariosRouter);
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

async function lastLog(table, recordId) {
  const [row] = await sql`
    select * from "AuditLog" where "table" = ${table} and "recordId" = ${recordId}
    order by "createdAt" desc limit 1`;
  return row;
}

test("trilha de auditoria (achado B9) — Financeiro, Contratos, Usuários (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const bootstrapEmail = "audit.fase5.b9-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Fase 5 - B9)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou — teste não pode continuar");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const A = apiAs(cookie);

  const auditLogIds = []; // limpeza explícita ao final, por id
  async function trackLogsFor(table, recordId) {
    const rows = await sql`select id from "AuditLog" where "table" = ${table} and "recordId" = ${recordId}`;
    auditLogIds.push(...rows.map((r) => r.id));
  }

  // ---- Financeiro: Conta a receber ----
  let receivableId;
  await t.test("POST /financeiro/receber — gera registro CREATE em AuditLog", async () => {
    const res = await A("POST", "/api/financeiro/receber", { description: TAG + "Receber", amount: "150,00" });
    assert.equal(res.status, 201);
    receivableId = res.body.id;
    const log = await lastLog("AccountReceivable", receivableId);
    assert.ok(log, "deveria existir um registro de auditoria");
    assert.equal(log.action, "CREATE");
    assert.equal(log.userName, "Bootstrap Admin (Fase 5 - B9)");
    assert.equal(log.before, null);
    assert.equal(log.after.description, TAG + "Receber");
  });

  await t.test("POST /financeiro/receber/:id/receber — gera registro UPDATE com before/after corretos", async () => {
    const res = await A("POST", `/api/financeiro/receber/${receivableId}/receber`, {});
    assert.equal(res.status, 200);
    const log = await lastLog("AccountReceivable", receivableId);
    assert.equal(log.action, "UPDATE");
    assert.equal(log.before.status, "PENDENTE");
    assert.equal(log.after.status, "RECEBIDO");
  });

  await t.test("DELETE /financeiro/receber/:id — gera registro DELETE com o registro apagado em before", async () => {
    const res = await A("DELETE", `/api/financeiro/receber/${receivableId}`);
    assert.equal(res.status, 200);
    const log = await lastLog("AccountReceivable", receivableId);
    assert.equal(log.action, "DELETE");
    assert.equal(log.after, null);
    assert.equal(log.before.description, TAG + "Receber");
    await trackLogsFor("AccountReceivable", receivableId);
  });

  // ---- Financeiro: Conta a pagar ----
  let payableId;
  await t.test("POST /financeiro/pagar — CREATE; marcar como pago — UPDATE; excluir — DELETE", async () => {
    const created = await A("POST", "/api/financeiro/pagar", { description: TAG + "Pagar", amount: "80,00" });
    assert.equal(created.status, 201);
    payableId = created.body.id;
    assert.equal((await lastLog("AccountPayable", payableId)).action, "CREATE");

    const paid = await A("POST", `/api/financeiro/pagar/${payableId}/pagar`, {});
    assert.equal(paid.status, 200);
    const updateLog = await lastLog("AccountPayable", payableId);
    assert.equal(updateLog.action, "UPDATE");
    assert.equal(updateLog.before.status, "PENDENTE");
    assert.equal(updateLog.after.status, "PAGO");

    const deleted = await A("DELETE", `/api/financeiro/pagar/${payableId}`);
    assert.equal(deleted.status, 200);
    assert.equal((await lastLog("AccountPayable", payableId)).action, "DELETE");
    await trackLogsFor("AccountPayable", payableId);
  });

  // ---- Contratos ----
  let contractId;
  await t.test("POST /contratos — CREATE; PUT — UPDATE; DELETE — DELETE", async () => {
    const created = await A("POST", "/api/contratos", { value: "1.000,00" });
    assert.equal(created.status, 201);
    contractId = created.body.id;
    const createLog = await lastLog("Contract", contractId);
    assert.equal(createLog.action, "CREATE");
    assert.equal(createLog.after.valueCents, 100000);

    const updated = await A("PUT", `/api/contratos/${contractId}`, { value: "2.000,00", status: "ENVIADO" });
    assert.equal(updated.status, 200);
    const updateLog = await lastLog("Contract", contractId);
    assert.equal(updateLog.action, "UPDATE");
    assert.equal(updateLog.before.valueCents, 100000);
    assert.equal(updateLog.after.valueCents, 200000);

    const deleted = await A("DELETE", `/api/contratos/${contractId}`);
    assert.equal(deleted.status, 200);
    const deleteLog = await lastLog("Contract", contractId);
    assert.equal(deleteLog.action, "DELETE");
    assert.equal(deleteLog.before.valueCents, 200000);
    await trackLogsFor("Contract", contractId);
  });

  // ---- Usuários — inclui a checagem crítica: passwordHash NUNCA na trilha ----
  let targetUserId;
  await t.test("POST /usuarios — CREATE em AuditLog, sem passwordHash em lugar nenhum", async () => {
    const res = await A("POST", "/api/usuarios", {
      name: TAG + "Usuario", email: "audit.fase5.b9-target@sued.local", role: "OPERACIONAL", password: "senha12345",
    });
    assert.equal(res.status, 201);
    targetUserId = res.body.id;
    const log = await lastLog("User", targetUserId);
    assert.equal(log.action, "CREATE");
    assert.equal(log.after.name, TAG + "Usuario");
    assert.equal("passwordHash" in log.after, false, "passwordHash NUNCA pode aparecer na trilha de auditoria");
  });

  await t.test("PUT /usuarios/:id — UPDATE com before/after, sem passwordHash", async () => {
    const res = await A("PUT", `/api/usuarios/${targetUserId}`, {
      name: TAG + "Usuario Renomeado", email: "audit.fase5.b9-target@sued.local", role: "OPERACIONAL", active: true,
    });
    assert.equal(res.status, 200);
    const log = await lastLog("User", targetUserId);
    assert.equal(log.action, "UPDATE");
    assert.equal(log.before.name, TAG + "Usuario");
    assert.equal(log.after.name, TAG + "Usuario Renomeado");
    assert.equal("passwordHash" in log.before, false);
    assert.equal("passwordHash" in log.after, false);
  });

  await t.test("POST /usuarios/:id/redefinir-senha — gera UPDATE, before/after null (nada sensível gravado)", async () => {
    const res = await A("POST", `/api/usuarios/${targetUserId}/redefinir-senha`, { password: "outrasenha123" });
    assert.equal(res.status, 200);
    const log = await lastLog("User", targetUserId);
    assert.equal(log.action, "UPDATE");
    assert.equal(log.before, null);
    assert.equal(log.after, null);
  });

  await t.test("DELETE /usuarios/:id — DELETE com before, sem passwordHash", async () => {
    const res = await A("DELETE", `/api/usuarios/${targetUserId}`);
    assert.equal(res.status, 200);
    const log = await lastLog("User", targetUserId);
    assert.equal(log.action, "DELETE");
    assert.equal(log.before.name, TAG + "Usuario Renomeado");
    assert.equal("passwordHash" in log.before, false);
    await trackLogsFor("User", targetUserId);
  });

  // ---- Confirma que o ESCOPO é respeitado: Leads NÃO gera auditoria ----
  await t.test("POST/PUT/DELETE /leads — NÃO geram registro em AuditLog (fora do escopo autorizado do B9)", async () => {
    const created = await A("POST", "/api/leads", { name: TAG + "LeadForaDoEscopo" });
    assert.equal(created.status, 201);
    const leadId = created.body.id;
    await A("PUT", `/api/leads/${leadId}`, { name: TAG + "LeadForaDoEscopo2" });
    await A("DELETE", `/api/leads/${leadId}`);
    const logs = await sql`select id from "AuditLog" where "table" = 'Lead' and "recordId" = ${leadId}`;
    assert.equal(logs.length, 0, "Leads não faz parte do escopo autorizado do B9 — não deveria gerar nenhum registro");
  });

  // ---- Limpeza ----
  await t.test("limpeza — nenhum dado AUDIT-FASE5-B9-* residual, incluindo os próprios registros de AuditLog", async () => {
    if (auditLogIds.length) await sql`delete from "AuditLog" where id in ${sql(auditLogIds)}`;
    const leftoverLogs = await sql`
      select id from "AuditLog"
      where "userName" like ${"%Fase 5 - B9%"} or "after"->>'description' like ${TAG + "%"} or "before"->>'description' like ${TAG + "%"}`;
    assert.equal(leftoverLogs.length, 0, "AuditLog (resíduo de teste)");

    const leftoverUsers = await sql`select id from "User" where name like ${TAG + "%"} or email = 'audit.fase5.b9-target@sued.local'`;
    assert.equal(leftoverUsers.length, 0, "User");

    // "marcar como recebido/pago" cria uma linha em "Transaction" como
    // efeito colateral (não há rota DELETE para ela — livro-razão,
    // apend-only, mesmo em produção) — precisa de limpeza própria aqui.
    await sql`delete from "Transaction" where description like ${TAG + "%"}`;
    const leftoverTx = await sql`select id from "Transaction" where description like ${TAG + "%"}`;
    assert.equal(leftoverTx.length, 0, "Transaction (resíduo de teste)");
  });
});
