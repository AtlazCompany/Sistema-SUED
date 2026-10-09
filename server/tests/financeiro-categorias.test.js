// Categorias do Financeiro (Lote 3): cadastro (entrada/saída), categoria nas
// contas e nos lançamentos, herança na liquidação, filtro do extrato e gastos
// do mês por categoria no resumo. Banco real + servidor Express local (pulam
// sem banco). Dados "TESTE-CAT-*", removidos ao final. As asserções olham só
// as categorias criadas aqui, então não dependem do que outros testes lançam.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { authRouter } from "../auth.js";
import { financeiroRouter } from "../routes/financeiro.js";
import { deleteTestUsers } from "./test-users.js";

const TAG = "TESTE-CAT-";
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
  await sql`delete from "FinanceCategory" where name like ${TAG + "%"}`;
  if (bootstrapId) await deleteTestUsers(sql, [bootstrapId]);
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

// Hoje no calendário de Teresina (UTC−3), "AAAA-MM-DD".
const brToday = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

test("categorias do financeiro (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  bootstrapId = randomUUID();
  const email = "teste.cat-bootstrap@sued.local";
  const password = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (Categorias)", email,
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
  const tx = async (col, id) => (await sql`select * from "Transaction" where ${sql(col)} = ${id}`)[0];

  let equipe; // SAIDA
  let eventos; // ENTRADA

  await t.test("cadastro: cria por tipo, recusa nome vazio, tipo inválido e repetido no mesmo tipo", async () => {
    const s = await A("POST", "/api/financeiro/categorias", { name: TAG + "Equipe", kind: "SAIDA" });
    assert.equal(s.status, 201);
    assert.equal(s.body.kind, "SAIDA");
    equipe = s.body;

    const e = await A("POST", "/api/financeiro/categorias", { name: TAG + "Eventos", kind: "ENTRADA" });
    assert.equal(e.status, 201);
    eventos = e.body;

    assert.equal((await A("POST", "/api/financeiro/categorias", { name: "  ", kind: "SAIDA" })).status, 400);
    assert.equal((await A("POST", "/api/financeiro/categorias", { name: TAG + "X", kind: "OUTRO" })).status, 400);
    const dup = await A("POST", "/api/financeiro/categorias", { name: (TAG + "equipe").toUpperCase(), kind: "SAIDA" });
    assert.equal(dup.status, 400, "mesmo nome (sem diferenciar maiúsculas) no mesmo tipo");
    const outroTipo = await A("POST", "/api/financeiro/categorias", { name: TAG + "Equipe", kind: "ENTRADA" });
    assert.equal(outroTipo.status, 201, "o mesmo nome pode existir no outro tipo");
  });

  await t.test("renomear muda só o nome; lista traz o uso e as opções do formulário trazem as categorias", async () => {
    const r = await A("PUT", `/api/financeiro/categorias/${equipe.id}`, { name: TAG + "Equipe fixa", kind: "ENTRADA" });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, TAG + "Equipe fixa");
    assert.equal(r.body.kind, "SAIDA", "o tipo não muda ao renomear");
    assert.equal((await A("PUT", `/api/financeiro/categorias/${randomUUID()}`, { name: TAG + "Z" })).status, 404);

    const lista = (await A("GET", "/api/financeiro/categorias")).body;
    const item = lista.find((c) => c.id === equipe.id);
    assert.equal(item.uses, 0);

    const { categories } = (await A("GET", "/api/financeiro/opcoes")).body;
    assert.ok(categories.some((c) => c.id === eventos.id && c.kind === "ENTRADA"));
  });

  await t.test("conta só aceita categoria do próprio tipo e que exista", async () => {
    const ok = await A("POST", "/api/financeiro/pagar", { description: TAG + "P1", amount: "300,00", categoryId: equipe.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.categoryId, equipe.id);

    const trocado = await A("POST", "/api/financeiro/pagar", { description: TAG + "P2", amount: "10,00", categoryId: eventos.id });
    assert.equal(trocado.status, 400, "categoria de entrada numa conta a pagar");
    const trocadoR = await A("POST", "/api/financeiro/receber", { description: TAG + "R2", amount: "10,00", categoryId: equipe.id });
    assert.equal(trocadoR.status, 400, "categoria de saída numa conta a receber");
    const inexistente = await A("POST", "/api/financeiro/receber", { description: TAG + "R3", amount: "10,00", categoryId: randomUUID() });
    assert.equal(inexistente.status, 400);

    const sem = await A("POST", "/api/financeiro/receber", { description: TAG + "R4", amount: "10,00" });
    assert.equal(sem.status, 201);
    assert.equal(sem.body.categoryId, null, "categoria é opcional");
  });

  await t.test("liquidar leva a categoria ao caixa; trocar a categoria de conta paga atualiza o lançamento", async () => {
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P3", amount: "150,00", categoryId: equipe.id });
    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`, { date: brToday() });
    assert.equal((await tx("payableId", c.body.id)).categoryId, equipe.id);

    const lista = (await A("GET", "/api/financeiro/pagar")).body;
    assert.equal(lista.find((r) => r.id === c.body.id).categoryName, TAG + "Equipe fixa");

    const outra = (await A("POST", "/api/financeiro/categorias", { name: TAG + "Fornecedores", kind: "SAIDA" })).body;
    const ed = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: TAG + "P3", amount: "999,00", categoryId: outra.id });
    assert.equal(ed.status, 200);
    assert.equal(ed.body.categoryId, outra.id, "categoria muda mesmo com a conta paga");
    assert.equal(ed.body.amountCents, 15000, "valor de conta paga continua igual");
    assert.equal((await tx("payableId", c.body.id)).categoryId, outra.id);

    const errado = await A("PUT", `/api/financeiro/pagar/${c.body.id}`, { description: TAG + "P3", categoryId: eventos.id });
    assert.equal(errado.status, 400, "conta paga também não aceita categoria do outro tipo");
  });

  await t.test("lançamento avulso aceita categoria do mesmo tipo", async () => {
    const ok = await A("POST", "/api/financeiro/lancamentos", { kind: "ENTRADA", description: TAG + "AvE", amount: "80,00", date: "2002-03-05", categoryId: eventos.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.categoryId, eventos.id);
    const errado = await A("POST", "/api/financeiro/lancamentos", { kind: "SAIDA", description: TAG + "AvS", amount: "80,00", date: "2002-03-05", categoryId: eventos.id });
    assert.equal(errado.status, 400);
  });

  await t.test("extrato filtra por categoria e por 'sem categoria'", async () => {
    await A("POST", "/api/financeiro/lancamentos", { kind: "SAIDA", description: TAG + "Ex1", amount: "40,00", date: "2002-03-10", categoryId: equipe.id });
    await A("POST", "/api/financeiro/lancamentos", { kind: "SAIDA", description: TAG + "Ex2", amount: "25,00", date: "2002-03-11" });
    const periodo = "from=2002-03-01&to=2002-03-31";

    const soEquipe = (await A("GET", `/api/financeiro/extrato?${periodo}&categoryId=${equipe.id}`)).body;
    assert.deepEqual(soEquipe.rows.map((r) => r.description), [TAG + "Ex1"]);
    assert.equal(soEquipe.rows[0].categoryName, TAG + "Equipe fixa");
    assert.equal(soEquipe.saidasCents, 4000);

    const semCat = (await A("GET", `/api/financeiro/extrato?${periodo}&categoryId=none`)).body;
    assert.ok(semCat.rows.some((r) => r.description === TAG + "Ex2"));
    assert.ok(semCat.rows.every((r) => r.categoryId === null));
  });

  await t.test("resumo: gastos do mês por categoria", async () => {
    const forn = (await A("GET", "/api/financeiro/categorias")).body.find((c) => c.name === TAG + "Fornecedores");
    const c = await A("POST", "/api/financeiro/pagar", { description: TAG + "P4", amount: "50,00", categoryId: equipe.id });
    await A("POST", `/api/financeiro/pagar/${c.body.id}/pagar`, { date: brToday() });

    const { gastosPorCategoria } = (await A("GET", "/api/financeiro/resumo")).body;
    const de = (id) => gastosPorCategoria.find((g) => g.categoryId === id);
    assert.equal(de(equipe.id).amountCents, 5000, "conta P4 paga hoje");
    assert.equal(de(equipe.id).name, TAG + "Equipe fixa");
    assert.equal(de(forn.id).amountCents, 15000, "conta P3 (paga hoje) mudou para Fornecedores");
    assert.equal(de(eventos.id), undefined, "entradas não entram nos gastos");
    for (let i = 1; i < gastosPorCategoria.length; i += 1)
      assert.ok(gastosPorCategoria[i - 1].amountCents >= gastosPorCategoria[i].amountCents, "do maior para o menor");
  });

  await t.test("excluir: categoria em uso não sai; sem uso sai; inexistente → 404", async () => {
    const emUso = await A("DELETE", `/api/financeiro/categorias/${equipe.id}`);
    assert.equal(emUso.status, 409);
    const usos = (await A("GET", "/api/financeiro/categorias")).body.find((c) => c.id === equipe.id).uses;
    assert.ok(usos >= 3, "contas e lançamentos contam como uso");

    const livre = (await A("POST", "/api/financeiro/categorias", { name: TAG + "Livre", kind: "SAIDA" })).body;
    assert.equal((await A("DELETE", `/api/financeiro/categorias/${livre.id}`)).status, 200);
    assert.equal((await A("DELETE", `/api/financeiro/categorias/${livre.id}`)).status, 404);
  });
});
