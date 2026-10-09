// Reserva de impostos: o imposto embutido em cada recebimento (1/6 do valor
// com 20%) é reservado; pagamentos de imposto abatem a reserva. Cálculo puro
// sempre roda; as rotas usam banco real + servidor Express local (pulam sem
// banco). Dados "TESTE-RES-*", removidos ao final. Só estes testes marcam
// contas/lançamentos com imposto, e "npm test" roda os arquivos em sequência
// (--test-concurrency=1), então os campos da reserva são comparados por
// diferença exata.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { eventosRouter } from "../routes/eventos.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { taxShareOfGross } from "../../public/src/budget-math.js";
import { deleteTestUsers } from "./test-users.js";

// ---------- cálculo puro ----------
test("taxShareOfGross — imposto embutido num valor bruto", () => {
  assert.equal(taxShareOfGross(120000, 20), 20000, "R$ 1.200 com 20% → R$ 200");
  assert.equal(taxShareOfGross(1001, 20), 167, "166,83 arredonda para 167");
  assert.equal(taxShareOfGross(120000, 0), 0, "sem imposto, sem reserva");
  assert.equal(taxShareOfGross(0, 20), 0);
});

// ---------- rotas ----------
const TAG = "TESTE-RES-";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let bootstrapId;
const eventIds = [];
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
  for (const id of budgetIds) await sql`delete from "Budget" where id = ${id}`;
  for (const id of eventIds) await sql`delete from "Event" where id = ${id}`;
  if (bootstrapId) await deleteTestUsers(sql, [bootstrapId]);
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

const brDate = (offsetDays = 0) => new Date(Date.now() - 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

test("reserva de impostos (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const email = "teste.res-bootstrap@sued.local";
  const password = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Reserva)", email,
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
  const resumo = async () => (await A("GET", "/api/financeiro/resumo")).body;
  const tx = async (col, id) => (await sql`select * from "Transaction" where ${sql(col)} = ${id}`)[0];

  await t.test("recebimento que inclui impostos reserva 1/6; estornar desfaz a reserva", async () => {
    const antes = (await resumo()).reservaImpostos;
    const c = await A("POST", "/api/financeiro/receber", { description: TAG + "R1", amount: "1.200,00", includesTax: true });
    assert.equal(c.status, 201);
    assert.equal(c.body.taxRatePercent, 20);
    assert.equal((await resumo()).reservaImpostos.reservadoCents, antes.reservadoCents, "pendente ainda não reserva nada");

    await A("POST", `/api/financeiro/receber/${c.body.id}/receber`, { date: brDate(-1) });
    assert.equal((await tx("receivableId", c.body.id)).taxReserveCents, 20000);
    const depois = await resumo();
    assert.equal(depois.reservaImpostos.reservadoCents, antes.reservadoCents + 20000);
    assert.equal(depois.reservaImpostos.saldoLivreCents, depois.saldoCents - depois.reservaImpostos.saldoCents);

    await A("POST", `/api/financeiro/receber/${c.body.id}/estornar`);
    assert.equal((await resumo()).reservaImpostos.reservadoCents, antes.reservadoCents);
  });

  await t.test("sem marcar impostos não há reserva; 'on' do formulário também vale", async () => {
    const sem = await A("POST", "/api/financeiro/receber", { description: TAG + "R2", amount: "600,00" });
    assert.equal(sem.body.taxRatePercent, 0);
    await A("POST", `/api/financeiro/receber/${sem.body.id}/receber`, { date: brDate(-1) });
    assert.equal((await tx("receivableId", sem.body.id)).taxReserveCents, 0);

    const form = await A("POST", "/api/financeiro/receber", { description: TAG + "R3", amount: "600,00", includesTax: "on" });
    assert.equal(form.body.taxRatePercent, 20);
  });

  await t.test("editar: pendente muda a opção; conta já recebida não muda", async () => {
    const c = await A("POST", "/api/financeiro/receber", { description: TAG + "R4", amount: "600,00" });
    const ed = await A("PUT", `/api/financeiro/receber/${c.body.id}`, { description: TAG + "R4", amount: "600,00", includesTax: true });
    assert.equal(ed.body.taxRatePercent, 20);
    await A("POST", `/api/financeiro/receber/${c.body.id}/receber`, { date: brDate(-1) });
    const paga = await A("PUT", `/api/financeiro/receber/${c.body.id}`, { description: TAG + "R4b", amount: "600,00", includesTax: false });
    assert.equal(paga.body.taxRatePercent, 20, "valor/opção de conta recebida não mudam");
  });

  await t.test("conta a pagar marcada como imposto abate a reserva", async () => {
    const antes = (await resumo()).reservaImpostos;
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P1", amount: "500,00", isTax: true });
    assert.equal(c.body.isTax, true);
    assert.equal((await resumo()).reservaImpostos.pagoCents, antes.pagoCents, "pendente ainda não abate");

    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`, { date: brDate(-1) });
    assert.equal((await tx("payableId", c.body.id)).isTax, true);
    const depois = (await resumo()).reservaImpostos;
    assert.equal(depois.pagoCents, antes.pagoCents + 50000);
    assert.equal(depois.saldoCents, antes.saldoCents - 50000);

    const comum = await A("POST", "/api/financeiro/pagar", { description: TAG + "P2", amount: "70,00" });
    await A("POST", `/api/financeiro/pagar/${comum.body.id}/pagar`, { date: brDate(-1) });
    assert.equal((await tx("payableId", comum.body.id)).isTax, false);
    assert.equal((await resumo()).reservaImpostos.pagoCents, depois.pagoCents, "pagamento comum não mexe na reserva");

    await A("DELETE", `/api/financeiro/pagar/${c.body.id}`);
    assert.equal((await resumo()).reservaImpostos.pagoCents, antes.pagoCents, "excluir a conta paga devolve a reserva");
  });

  await t.test("lançamentos avulsos: entrada com impostos reserva; saída de imposto abate", async () => {
    const antes = (await resumo()).reservaImpostos;
    const ent = await A("POST", "/api/financeiro/lancamentos", { kind: "ENTRADA", description: TAG + "AvE", amount: "600,00", date: "2001-06-01", includesTax: true });
    const sai = await A("POST", "/api/financeiro/lancamentos", { kind: "SAIDA", description: TAG + "AvS", amount: "100,00", date: "2001-06-02", isTax: true });
    assert.equal(ent.body.taxReserveCents, 10000);
    assert.equal(sai.body.isTax, true);

    const ext = (await A("GET", "/api/financeiro/extrato?from=2001-06-01&to=2001-06-30")).body;
    assert.deepEqual(ext.rows.map((r) => [r.taxReserveCents, r.isTax]), [[10000, false], [0, true]]);
    const meio = (await resumo()).reservaImpostos;
    assert.equal(meio.reservadoCents, antes.reservadoCents + 10000);
    assert.equal(meio.pagoCents, antes.pagoCents + 10000);

    await A("DELETE", `/api/financeiro/lancamentos/${ent.body.id}`);
    await A("DELETE", `/api/financeiro/lancamentos/${sai.body.id}`);
    assert.deepEqual((await resumo()).reservaImpostos, { ...antes, saldoLivreCents: (await resumo()).reservaImpostos.saldoLivreCents });
  });

  await t.test("previsão: reserva projetada soma o imposto a receber e tira o imposto a pagar", async () => {
    const antes = await resumo();
    await A("POST", "/api/financeiro/receber", { description: TAG + "PrR10", amount: "1.200,00", includesTax: true, dueDate: brDate(10) }); // +200
    await A("POST", "/api/financeiro/receber", { description: TAG + "PrR45", amount: "600,00", includesTax: true, dueDate: brDate(45) }); // +100
    await A("POST", "/api/financeiro/pagar", { description: TAG + "PrP20", amount: "300,00", isTax: true, dueDate: brDate(20) }); // −300
    const dep = await resumo();

    assert.equal(dep.reservaImpostos.aReservarCents, antes.reservaImpostos.aReservarCents + 30000);
    const delta = (i) => dep.previsao[i].reservaCents - antes.previsao[i].reservaCents;
    assert.equal(delta(0), 20000 - 30000, "30 dias: +200 a reservar, −300 de imposto a pagar");
    assert.equal(delta(1), 20000 + 10000 - 30000, "60 dias: entra também o recebível de 45 dias");
    assert.equal(delta(2), 0);
    for (const p of dep.previsao)
      assert.equal(p.saldoLivreProjetadoCents, p.saldoProjetadoCents - p.reservaCents);
  });

  await t.test("opcoes: evento com orçamento aprovado e com imposto vem marcado", async () => {
    const comOrc = await A("POST", "/api/eventos", { title: TAG + "EvOrc" });
    const semOrc = await A("POST", "/api/eventos", { title: TAG + "EvSem" });
    eventIds.push(comOrc.body.id, semOrc.body.id);
    const budgetId = randomUUID();
    budgetIds.push(budgetId);
    await sql`insert into "Budget" ${sql({
      id: budgetId, number: TAG + "ORC", eventId: comOrc.body.id, status: "APROVADO", vigente: true,
      taxRatePercent: 20, createdAt: new Date(), updatedAt: new Date(),
    })}`;
    const { events } = (await A("GET", "/api/financeiro/opcoes")).body;
    assert.equal(events.find((e) => e.id === comOrc.body.id).hasTaxedBudget, true);
    assert.equal(events.find((e) => e.id === semOrc.body.id).hasTaxedBudget, false);

    await sql`update "Budget" set "taxRatePercent" = 0 where id = ${budgetId}`;
    const depois = (await A("GET", "/api/financeiro/opcoes")).body.events;
    assert.equal(depois.find((e) => e.id === comOrc.body.id).hasTaxedBudget, false, "orçamento antigo (0%) não marca");
  });
});
