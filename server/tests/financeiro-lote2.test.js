// Financeiro, Lote 2: extrato do fluxo de caixa (período + saldo acumulado),
// lançamentos avulsos e resumo (mês, previsão 30/60/90, próximos vencimentos).
// Banco real + servidor Express local (pula sem banco). Dados "TESTE-FIN2-*",
// removidos ao final. O extrato usa datas de 2001 para ficar isolado de
// qualquer outro dado do banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { eventosRouter } from "../routes/eventos.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { deleteTestUsers } from "./test-users.js";

const TAG = "TESTE-FIN2-";
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

// Data civil de Teresina (UTC−3), AAAA-MM-DD.
const brDate = (offsetDays = 0) => new Date(Date.now() - 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

test("financeiro lote 2 (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const email = "teste.fin2-bootstrap@sued.local";
  const password = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Financeiro Lote 2)", email,
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
  const lancar = (kind, description, amount, date, extra = {}) =>
    A("POST", "/api/financeiro/lancamentos", { kind, description: TAG + description, amount, date, ...extra });

  await t.test("lançamento avulso: validações", async () => {
    assert.equal((await lancar("OUTRO", "x", "1,00", brDate())).status, 400, "tipo inválido");
    assert.equal((await lancar("ENTRADA", "x", "0,00", brDate())).status, 400, "valor zero");
    assert.equal((await lancar("SAIDA", "x", "-5,00", brDate())).status, 400, "valor negativo");
    assert.equal((await lancar("ENTRADA", "x", "1,00", brDate(10))).status, 400, "data futura");
    assert.equal((await A("POST", "/api/financeiro/lancamentos", { kind: "ENTRADA", amount: "1,00" })).status, 400, "sem descrição");
    assert.equal((await lancar("ENTRADA", "x", "1,00", brDate(), { eventId: randomUUID() })).status, 400, "evento inexistente");
  });

  await t.test("extrato: período, saldo inicial e saldo acumulado", async () => {
    assert.equal((await lancar("ENTRADA", "Saldo inicial", "1.000,00", "2001-01-10")).status, 201);
    assert.equal((await lancar("ENTRADA", "Venda", "500,00", "2001-02-05")).status, 201);
    assert.equal((await lancar("SAIDA", "Tarifa", "200,00", "2001-02-20")).status, 201);
    assert.equal((await lancar("SAIDA", "Taxa", "50,00", "2001-03-02")).status, 201);

    const fev = (await A("GET", "/api/financeiro/extrato?from=2001-02-01&to=2001-02-28")).body;
    assert.equal(fev.openingCents, 100000);
    assert.equal(fev.entradasCents, 50000);
    assert.equal(fev.saidasCents, 20000);
    assert.equal(fev.closingCents, 130000);
    assert.deepEqual(fev.rows.map((r) => r.balanceCents), [150000, 130000]);
    assert.ok(fev.rows.every((r) => r.avulso === true));

    const dia = (await A("GET", "/api/financeiro/extrato?from=2001-02-20&to=2001-02-20")).body;
    assert.equal(dia.rows.length, 1, "o último dia do período entra");

    const marAdiante = (await A("GET", "/api/financeiro/extrato?from=2001-03-01&to=2001-12-31")).body;
    assert.equal(marAdiante.openingCents, 130000);
    assert.deepEqual(marAdiante.rows.map((r) => r.balanceCents), [125000]);

    const ano = (await A("GET", "/api/financeiro/extrato?from=2001-01-01&to=2001-12-31")).body;
    assert.equal(ano.rows.length, 4);
    assert.equal(ano.closingCents, 125000);

    assert.equal((await A("GET", "/api/financeiro/extrato?from=2001-05-01&to=2001-04-01")).status, 400);
    assert.equal((await A("GET", "/api/financeiro/extrato?from=lixo")).status, 400);
  });

  await t.test("lançamento avulso com evento soma no realizado; excluir reverte", async () => {
    const ev = await A("POST", "/api/eventos", { title: TAG + "Ev" });
    eventIds.push(ev.body.id);
    const real = async () => (await sql`select "actualRevenueCents" as rev, "actualCostCents" as cost from "Event" where id = ${ev.body.id}`)[0];

    const ent = await lancar("ENTRADA", "Sinal avulso", "700,00", brDate(-1), { eventId: ev.body.id });
    const sai = await lancar("SAIDA", "Despesa avulsa", "120,00", brDate(-1), { eventId: ev.body.id });
    assert.deepEqual(await real(), { rev: 70000, cost: 12000 });

    assert.equal((await A("DELETE", `/api/financeiro/lancamentos/${ent.body.id}`)).status, 200);
    assert.equal((await A("DELETE", `/api/financeiro/lancamentos/${sai.body.id}`)).status, 200);
    assert.deepEqual(await real(), { rev: 0, cost: 0 });
    assert.equal((await A("DELETE", `/api/financeiro/lancamentos/${ent.body.id}`)).status, 404);
  });

  await t.test("lançamento que veio de uma conta não pode ser excluído avulso", async () => {
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "Conta", amount: "40,00" });
    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`, { date: brDate(-1) });
    const [tx] = await sql`select id from "Transaction" where "payableId" = ${c.body.id}`;
    const r = await A("DELETE", `/api/financeiro/lancamentos/${tx.id}`);
    assert.equal(r.status, 400);
    const ext = (await A("GET", `/api/financeiro/extrato?from=${brDate(-1)}&to=${brDate(-1)}`)).body;
    assert.equal(ext.rows.find((x) => x.id === tx.id).avulso, false, "veio de conta → não é avulso");
  });

  await t.test("resumo: mês corrente, previsão 30/60/90 e próximos vencimentos", async () => {
    const antes = (await A("GET", "/api/financeiro/resumo")).body;
    assert.deepEqual(antes.previsao.map((p) => p.dias), [30, 60, 90]);

    await lancar("ENTRADA", "Entrada do mês", "123,45", brDate(0));
    // receber: 777,00 em 10 dias; 333,00 em 45 dias; 111,00 em 80 dias; 55,00 sem vencimento
    // pagar:   444,00 em 20 dias; 222,00 em 100 dias (fora de todos os horizontes)
    await A("POST", "/api/financeiro/receber", { description: TAG + "R10", amount: "777,00", dueDate: brDate(10) });
    await A("POST", "/api/financeiro/receber", { description: TAG + "R45", amount: "333,00", dueDate: brDate(45) });
    await A("POST", "/api/financeiro/receber", { description: TAG + "R80", amount: "111,00", dueDate: brDate(80) });
    await A("POST", "/api/financeiro/receber", { description: TAG + "RSem", amount: "55,00" });
    await A("POST", "/api/financeiro/pagar", { description: TAG + "P20", amount: "444,00", dueDate: brDate(20) });
    await A("POST", "/api/financeiro/pagar", { description: TAG + "P100", amount: "222,00", dueDate: brDate(100) });

    const dep = (await A("GET", "/api/financeiro/resumo")).body;
    // Outros testes rodam em paralelo no mesmo banco: só podem ADICIONAR, por isso ">=".
    assert.ok(dep.mes.entradasCents >= antes.mes.entradasCents + 12345);
    assert.equal(dep.mes.resultadoCents, dep.mes.entradasCents - dep.mes.saidasCents);

    const [p30, p60, p90] = dep.previsao;
    const [a30, a60, a90] = antes.previsao;
    assert.ok(p30.receberCents - a30.receberCents >= 77700);
    assert.ok(p60.receberCents - a60.receberCents >= 77700 + 33300);
    assert.ok(p90.receberCents - a90.receberCents >= 77700 + 33300 + 11100);
    assert.ok(p30.pagarCents - a30.pagarCents >= 44400);
    assert.ok(p90.pagarCents - a90.pagarCents >= 44400, "a conta de 100 dias fica fora de 90");
    assert.ok(dep.semVencimento.receberCents >= antes.semVencimento.receberCents + 5500);
    for (const p of dep.previsao)
      assert.equal(p.saldoProjetadoCents, dep.saldoCents + p.receberCents - p.pagarCents);

    const proximos = dep.proximos;
    assert.ok(proximos.length <= 8);
    const datas = proximos.map((p) => String(p.dueDate).slice(0, 10));
    assert.deepEqual(datas, [...datas].sort(), "próximos vêm em ordem de vencimento");
    assert.ok(proximos.every((p) => p.kind === "receber" || p.kind === "pagar"));
  });
});
