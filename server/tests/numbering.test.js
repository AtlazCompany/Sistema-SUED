// Testa o MECANISMO de numeração segura (sequence do Postgres) usado por
// nextNumber() em orcamentos.js/contratos.js. Usa uma sequence PRÓPRIA e
// descartável (criada e destruída dentro do teste) — nunca toca em
// "Budget_number_seq"/"Contract_number_seq" nem em dados reais de Orçamento
// ou Contrato. Se não houver conexão com o banco, os testes são pulados
// (não falham) — não dependemos de um banco de produção disponível.
import { test } from "node:test";
import postgres from "postgres";
import assert from "node:assert/strict";

const TEST_SEQ = "sued_test_numbering_seq_temp";

let sql;
let dbAvailable = false;

try {
  sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 3, connect_timeout: 5 });
  await sql`select 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

test("numeração — sequence gera valores estritamente crescentes e sem colisão sob concorrência", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async () => {
  await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS "${TEST_SEQ}"`);
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => sql.unsafe(`select nextval('"${TEST_SEQ}"') as n`)),
    );
    const nums = results.map((r) => Number(r[0].n)).sort((a, b) => a - b);
    const unique = new Set(nums);
    assert.equal(unique.size, nums.length, "20 chamadas simultâneas devem gerar 20 números únicos");
    assert.deepEqual(nums, Array.from({ length: 20 }, (_, i) => i + 1));
  } finally {
    await sql.unsafe(`DROP SEQUENCE IF EXISTS "${TEST_SEQ}"`);
  }
});

test("numeração — formato final (ex.: ORC-0001) preserva zero-padding de 4 dígitos", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async () => {
  await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS "${TEST_SEQ}"`);
  try {
    const [{ n }] = await sql.unsafe(`select nextval('"${TEST_SEQ}"') as n`);
    const formatted = "ORC-" + String(n).padStart(4, "0");
    assert.equal(formatted, "ORC-0001");
  } finally {
    await sql.unsafe(`DROP SEQUENCE IF EXISTS "${TEST_SEQ}"`);
  }
});

test("numeração — 'exclusão' de registro não causa reuso (sequence nunca anda para trás)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async () => {
  await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS "${TEST_SEQ}"`);
  try {
    const [{ n: first }] = await sql.unsafe(`select nextval('"${TEST_SEQ}"') as n`);
    const [{ n: second }] = await sql.unsafe(`select nextval('"${TEST_SEQ}"') as n`);
    // Mesmo simulando "o registro do número `first` foi excluído", a
    // sequence não sabe disso e não recua — próxima chamada continua > second.
    const [{ n: third }] = await sql.unsafe(`select nextval('"${TEST_SEQ}"') as n`);
    assert.ok(Number(second) > Number(first));
    assert.ok(Number(third) > Number(second));
  } finally {
    await sql.unsafe(`DROP SEQUENCE IF EXISTS "${TEST_SEQ}"`);
  }
});

test("cleanup", { skip: !dbAvailable }, async () => {
  await sql.end();
});
