// Financeiro, Lote 1: editar, liquidar com data real, estornar, cancelar,
// parcelar, excluir conta liquidada (reverte caixa e evento) e atraso por
// data civil. Cálculo de parcelas roda sempre; as rotas usam banco real e um
// servidor Express local (pulam sem banco). Dados "TESTE-FIN1-*", removidos
// ao final.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { eventosRouter } from "../routes/eventos.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { addMonthsClamped } from "../utils.js";
import { deleteTestUsers } from "./test-users.js";

// ---------- parcelas (puro) ----------
test("addMonthsClamped — mantém o dia; mês curto usa o último dia", () => {
  const iso = (d) => d.toISOString().slice(0, 10);
  const base = new Date("2026-01-31");
  assert.equal(iso(addMonthsClamped(base, 0)), "2026-01-31");
  assert.equal(iso(addMonthsClamped(base, 1)), "2026-02-28");
  assert.equal(iso(addMonthsClamped(base, 2)), "2026-03-31");
  assert.equal(iso(addMonthsClamped(new Date("2026-11-10"), 3)), "2027-02-10", "virada de ano");
  assert.equal(iso(addMonthsClamped(new Date("2027-12-31"), 2)), "2028-02-29", "ano bissexto");
});

// ---------- rotas ----------
const TAG = "TESTE-FIN1-";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;
const eventIds = [];

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
  await sql`delete from "Transaction" where description like ${TAG + "%"}`;
  await sql`delete from "AccountReceivable" where description like ${TAG + "%"}`;
  await sql`delete from "AccountPayable" where description like ${TAG + "%"}`;
  for (const id of eventIds) await sql`delete from "Event" where id = ${id}`;
  if (bootstrapId) await deleteTestUsers(sql, [bootstrapId]);
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

// Data civil de Teresina (UTC−3), no formato AAAA-MM-DD.
const brDate = (offsetDays = 0) => new Date(Date.now() - 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

test("financeiro lote 1 (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const email = "teste.fin1-bootstrap@sued.local";
  const password = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Financeiro Lote 1)", email,
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
  const novoEvento = async (nome) => {
    const r = await A("POST", "/api/eventos", { title: TAG + nome });
    assert.equal(r.status, 201);
    eventIds.push(r.body.id);
    return r.body.id;
  };
  const evento = async (id) => (await sql`select "actualRevenueCents" as rev, "actualCostCents" as cost from "Event" where id = ${id}`)[0];
  const transacoes = (col, id) => sql`select * from "Transaction" where ${sql(col)} = ${id}`;

  await t.test("receber com data real; estornar desfaz caixa e evento", async () => {
    const ev = await novoEvento("EvR");
    const c = await A("POST", "/api/financeiro/receber", { description: TAG + "R1", amount: "1.000,00", eventId: ev, dueDate: brDate(5) });
    assert.equal(c.status, 201);
    const dia = brDate(-2);
    const liq = await A("POST", `/api/financeiro/receber/${c.body.id}/receber`, { date: dia });
    assert.equal(liq.status, 200);

    const [tx] = await transacoes("receivableId", c.body.id);
    assert.equal(tx.kind, "ENTRADA");
    assert.equal(tx.amountCents, 100000);
    assert.equal(tx.date.toISOString().slice(0, 10), dia, "o lançamento usa a data informada");
    assert.equal((await evento(ev)).rev, 100000);

    const est = await A("POST", `/api/financeiro/receber/${c.body.id}/estornar`);
    assert.equal(est.status, 200);
    const [conta] = await sql`select status, "receivedDate" from "AccountReceivable" where id = ${c.body.id}`;
    assert.equal(conta.status, "PENDENTE");
    assert.equal(conta.receivedDate, null);
    assert.equal((await transacoes("receivableId", c.body.id)).length, 0);
    assert.equal((await evento(ev)).rev, 0);

    const denovo = await A("POST", `/api/financeiro/receber/${c.body.id}/estornar`);
    assert.equal(denovo.status, 400, "só dá para estornar conta recebida");
  });

  await t.test("liquidar duas vezes não duplica o lançamento; data no futuro é recusada", async () => {
    const ev = await novoEvento("EvP");
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P1", amount: "300,00", eventId: ev });
    const futuro = await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`, { date: brDate(10) });
    assert.equal(futuro.status, 400);
    assert.equal((await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`)).status, 200);
    assert.equal((await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`)).status, 200);
    assert.equal((await transacoes("payableId", c.body.id)).length, 1);
    assert.equal((await evento(ev)).cost, 30000);
  });

  await t.test("excluir conta paga reverte o caixa e o realizado do evento", async () => {
    const ev = await novoEvento("EvDel");
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P2", amount: "250,00", eventId: ev });
    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`);
    assert.equal((await evento(ev)).cost, 25000);
    assert.equal((await A("DELETE", `/api/financeiro/pagar/${c.body.id}`)).status, 200);
    assert.equal((await transacoes("payableId", c.body.id)).length, 0);
    assert.equal((await evento(ev)).cost, 0);
    assert.equal((await A("DELETE", `/api/financeiro/pagar/${c.body.id}`)).status, 404);
  });

  await t.test("editar: pendente muda tudo; paga só a descrição (e o lançamento acompanha)", async () => {
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P3", amount: "100,00", dueDate: brDate(3) });
    const ed = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: TAG + "P3 editada", amount: "120,50", dueDate: brDate(7) });
    assert.equal(ed.status, 200);
    assert.equal(ed.body.amountCents, 12050);
    assert.equal(ed.body.dueDate.slice(0, 10), brDate(7));

    const semDescricao = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: "", amount: "10,00" });
    assert.equal(semDescricao.status, 400);
    const valorZero = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: TAG + "x", amount: "0,00" });
    assert.equal(valorZero.status, 400);

    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`);
    const paga = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: TAG + "P3 paga", amount: "999,00", dueDate: brDate(30) });
    assert.equal(paga.status, 200);
    assert.equal(paga.body.amountCents, 12050, "valor de conta paga não muda");
    assert.equal(paga.body.description, TAG + "P3 paga");
    const [tx] = await transacoes("payableId", c.body.id);
    assert.equal(tx.description, TAG + "P3 paga");
    assert.equal(tx.amountCents, 12050);

    assert.equal((await A("PUT", `/api/financeiro/pagar/${randomUUID()}`, { description: TAG + "?", amount: "1,00" })).status, 404);
  });

  await t.test("cancelar: só pendente; cancelada não edita nem liquida", async () => {
    const c = await A("POST", "/api/financeiro/receber", { description: TAG + "R2", amount: "80,00" });
    assert.equal((await A("POST", `/api/financeiro/receber/${c.body.id}/cancelar`)).status, 200);
    const [conta] = await sql`select status from "AccountReceivable" where id = ${c.body.id}`;
    assert.equal(conta.status, "CANCELADO");
    assert.equal((await A("POST", `/api/financeiro/receber/${c.body.id}/cancelar`)).status, 400);
    assert.equal((await A("POST", `/api/financeiro/receber/${c.body.id}/receber`)).status, 400);
    assert.equal((await A("PUT", `/api/financeiro/receber/${c.body.id}`, { description: TAG + "R2", amount: "80,00" })).status, 400);

    const paga = await A("POST", "/api/financeiro/receber", { description: TAG + "R3", amount: "80,00" });
    await A("POST", `/api/financeiro/receber/${paga.body.id}/receber`);
    assert.equal((await A("POST", `/api/financeiro/receber/${paga.body.id}/cancelar`)).status, 400, "estorne antes de cancelar");
  });

  await t.test("parcelas: N contas mensais com sufixo (i/N); validações", async () => {
    const r = await A("POST", "/api/financeiro/receber", { description: TAG + "Parc", amount: "1.000,00", dueDate: "2026-01-31", installments: 3 });
    assert.equal(r.status, 201);
    const parcelas = r.body.parcelas;
    assert.equal(parcelas.length, 3);
    assert.deepEqual(parcelas.map((p) => p.description), [TAG + "Parc (1/3)", TAG + "Parc (2/3)", TAG + "Parc (3/3)"]);
    assert.deepEqual(parcelas.map((p) => p.dueDate.slice(0, 10)), ["2026-01-31", "2026-02-28", "2026-03-31"]);
    assert.ok(parcelas.every((p) => p.amountCents === 100000 && p.status === "PENDENTE"));

    assert.equal((await A("POST", "/api/financeiro/pagar", { description: TAG + "x", amount: "1,00", installments: 0 })).status, 400);
    assert.equal((await A("POST", "/api/financeiro/pagar", { description: TAG + "x", amount: "1,00", installments: 37, dueDate: brDate(1) })).status, 400);
    assert.equal((await A("POST", "/api/financeiro/pagar", { description: TAG + "x", amount: "1,00", installments: 2 })).status, 400, "parcelar exige vencimento");

    const unica = await A("POST", "/api/financeiro/pagar", { description: TAG + "Unica", amount: "5,00" });
    assert.equal(unica.status, 201);
    assert.equal(unica.body.description, TAG + "Unica", "sem parcelas, a descrição não ganha sufixo");
  });

  await t.test("atraso: vence hoje não é atrasada; vence ontem é (a pagar e a receber)", async () => {
    const antes = (await A("GET", "/api/financeiro/resumo")).body;
    await A("POST", "/api/financeiro/pagar", { description: TAG + "Hoje", amount: "10,00", dueDate: brDate(0) });
    const aposHoje = (await A("GET", "/api/financeiro/resumo")).body;
    assert.equal(aposHoje.atrasadasPagar, antes.atrasadasPagar, "vence hoje ainda não está atrasada");

    await A("POST", "/api/financeiro/pagar", { description: TAG + "Ontem", amount: "20,00", dueDate: brDate(-1) });
    await A("POST", "/api/financeiro/receber", { description: TAG + "RAtras", amount: "30,00", dueDate: brDate(-1) });
    const depois = (await A("GET", "/api/financeiro/resumo")).body;
    assert.ok(depois.atrasadasPagar >= antes.atrasadasPagar + 1);
    assert.ok(depois.atrasadasPagarCents >= antes.atrasadasPagarCents + 2000);
    assert.ok(depois.atrasadas >= antes.atrasadas + 1);
  });
});
