// Script de configuração ÚNICA e IDEMPOTENTE para numeração segura de
// Orçamentos e Contratos. Pode ser executado quantas vezes for preciso —
// sempre verifica se o objeto já existe antes de criar.
//
// Uso: node --env-file=.env setup-numbering.mjs
//
// O que faz:
//   1. Cria as sequences "Budget_number_seq" e "Contract_number_seq"
//      (se ainda não existirem) — usadas para gerar "ORC-0001"/"CT-0001"
//      sem risco de dois usuários receberem o mesmo número ao criar ao
//      mesmo tempo (nextval() do Postgres é atômico e nunca repete valor,
//      mesmo sob concorrência ou após exclusão de registros).
//   2. Adiciona UNIQUE em "Budget".number e "Contract".number (se ainda
//      não existir) — trava extra a nível de banco, redundante com a
//      sequence, mas sem custo (tabelas vazias hoje).
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

async function ensureSequence(name) {
  const [{ exists }] = await sql`
    select exists(select 1 from pg_class where relkind = 'S' and relname = ${name}) as exists`;
  if (exists) {
    console.log(`- sequence "${name}" já existe, nada a fazer.`);
    return;
  }
  await sql.unsafe(`CREATE SEQUENCE "${name}"`);
  console.log(`+ sequence "${name}" criada.`);
}

async function ensureUnique(table, column, constraintName) {
  const [{ exists }] = await sql`
    select exists(select 1 from pg_constraint where conname = ${constraintName}) as exists`;
  if (exists) {
    console.log(`- UNIQUE "${constraintName}" já existe, nada a fazer.`);
    return;
  }
  await sql.unsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}" UNIQUE ("${column}")`);
  console.log(`+ UNIQUE "${constraintName}" criada em "${table}"."${column}".`);
}

try {
  console.log("== Sequences ==");
  await ensureSequence("Budget_number_seq");
  await ensureSequence("Contract_number_seq");

  console.log("\n== UNIQUE constraints (segurança extra em nível de banco) ==");
  await ensureUnique("Budget", "number", "Budget_number_key");
  await ensureUnique("Contract", "number", "Contract_number_key");

  console.log("\nConcluído. Nenhum dado existente foi alterado.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
