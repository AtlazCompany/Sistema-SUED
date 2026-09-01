// Script de configuração ÚNICA e IDEMPOTENTE para o achado B7 (Fase 5):
// revogação de sessão ao trocar senha, via versionamento de token.
//
// Uso: node --env-file=.env setup-token-version.mjs
//
// O que faz:
//   1. Adiciona a coluna "User"."tokenVersion" (integer, NOT NULL, DEFAULT 0)
//      se ainda não existir. Linhas existentes recebem 0 automaticamente
//      (preenchido pelo próprio Postgres via DEFAULT, sem UPDATE manual).
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente. Sem esse
// script rodado, o código de auth.js/usuarios.js que lê/grava
// "tokenVersion" falhará — rodar ANTES de subir o código que depende dele.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

async function ensureColumn(table, column, ddl) {
  const [{ exists }] = await sql`
    select exists(
      select 1 from information_schema.columns
      where table_name = ${table} and column_name = ${column}
    ) as exists`;
  if (exists) {
    console.log(`- coluna "${table}"."${column}" já existe, nada a fazer.`);
    return;
  }
  await sql.unsafe(ddl);
  console.log(`+ coluna "${table}"."${column}" criada.`);
}

try {
  console.log("== Coluna de versionamento de token ==");
  await ensureColumn("User", "tokenVersion", `ALTER TABLE "User" ADD COLUMN "tokenVersion" integer NOT NULL DEFAULT 0`);

  console.log("\nConcluído. Nenhum dado existente foi alterado (linhas atuais receberam tokenVersion = 0).");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
