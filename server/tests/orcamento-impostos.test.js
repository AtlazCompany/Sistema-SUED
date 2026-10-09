// Impostos de 20% em todo orçamento: cálculo puro (sempre roda) + rotas com
// banco real e servidor Express local (pula graciosamente sem banco).
// Dados "TESTE-IMPOSTO-*", removidos ao final.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { orcamentosRouter, orcamentoPublicoRouter } from "../routes/orcamentos.js";
import { deleteTestUsers } from "./test-users.js";
import { TAX_RATE_PERCENT, calcBudgetTotals } from "../../public/src/budget-math.js";

// ---------- cálculo puro ----------
test("calcBudgetTotals — 20% sobre (subtotal − desconto), em centavos", () => {
  assert.equal(TAX_RATE_PERCENT, 20);
  const t = calcBudgetTotals({ subtotalCents: 100000, discountCents: 10000, costCents: 40000, taxRatePercent: 20 });
  assert.equal(t.baseCents, 90000);
  assert.equal(t.taxCents, 18000);
  assert.equal(t.totalCents, 108000);
  assert.equal(t.profitCents, 50000, "lucro sai da base, sem o imposto");
  assert.equal(t.marginPercent.toFixed(1), "55.6");
});

test("calcBudgetTotals — arredonda o imposto para centavo inteiro", () => {
  const t = calcBudgetTotals({ subtotalCents: 1001, taxRatePercent: 20 }); // 200,2 → 200
  assert.equal(t.taxCents, 200);
  assert.ok(Number.isInteger(t.totalCents));
});

test("calcBudgetTotals — orçamento antigo (0%) não muda; base zero não quebra", () => {
  const velho = calcBudgetTotals({ subtotalCents: 50000, discountCents: 5000, taxRatePercent: 0 });
  assert.equal(velho.taxCents, 0);
  assert.equal(velho.totalCents, 45000);
  const zero = calcBudgetTotals({ subtotalCents: 0, taxRatePercent: 20 });
  assert.equal(zero.totalCents, 0);
  assert.equal(zero.marginPercent, null);
});

// ---------- rotas ----------
const TAG = "TESTE-IMPOSTO-";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;
const budgetIds = [];

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
  app.use("/api/orcamentos", orcamentosRouter);
  app.use("/api/orcamento-publico", orcamentoPublicoRouter);
  app.use((err, req, res, _next) => {
    if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
    res.status(err.status || 500).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!dbAvailable) return;
  for (const id of budgetIds) await sql`delete from "BudgetItem" where "budgetId" = ${id}`;
  for (const id of budgetIds) await sql`delete from "Budget" where id = ${id}`;
  if (bootstrapId) await deleteTestUsers(sql, [bootstrapId]);
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

test("impostos nas rotas de orçamento (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const email = "teste.imposto-bootstrap@sued.local";
  const password = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Impostos)", email,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(password, 10),
  })}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, "login do admin de bootstrap falhou");
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  async function A(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method, headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  // subtotal = 2 × 50000 = 100000; desconto 10000 → base 90000 → imposto 18000 → total 108000
  const itens = [{ description: TAG + "Item", quantity: 2, unitPriceCents: 50000, unitCostCents: 20000 }];
  let id;

  await t.test("POST grava 20% e GET devolve imposto e total; o navegador não escolhe a taxa", async () => {
    const criado = await A("POST", "/api/orcamentos", { discount: "100,00", items: itens, taxRatePercent: 0 });
    assert.equal(criado.status, 201);
    id = criado.body.id;
    budgetIds.push(id);
    assert.equal(criado.body.taxRatePercent, 20, "a taxa enviada pelo cliente deve ser ignorada");

    const lido = await A("GET", `/api/orcamentos/${id}`);
    assert.equal(lido.body.taxCents, 18000);
    assert.equal(lido.body.totalCents, 108000);
  });

  await t.test("a listagem traz o total com impostos", async () => {
    const lista = await A("GET", "/api/orcamentos");
    const row = lista.body.find((b) => b.id === id);
    assert.equal(row.totalCents, 108000);
  });

  await t.test("link público mostra a taxa, sem custo/margem", async () => {
    const pub = await A("GET", `/api/orcamento-publico/${id}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.taxRatePercent, 20);
    assert.equal(pub.body.items[0].unitCostCents, undefined);
  });

  await t.test("orçamento antigo (0%) mantém o total até ser salvo; ao salvar vira 20%", async () => {
    await sql`update "Budget" set "taxRatePercent" = 0 where id = ${id}`;
    const antigo = await A("GET", `/api/orcamentos/${id}`);
    assert.equal(antigo.body.taxCents, 0);
    assert.equal(antigo.body.totalCents, 90000);

    const salvo = await A("PUT", `/api/orcamentos/${id}`, { status: "RASCUNHO", discount: "100,00", items: itens });
    assert.equal(salvo.status, 200);
    assert.equal(salvo.body.taxRatePercent, 20);
  });
});
