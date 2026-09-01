// Script de configuração ÚNICA e IDEMPOTENTE para o achado B14 (Fase 5):
// recuperação de senha por e-mail. Autorizado explicitamente pelo usuário:
// 2 colunas novas em "User" (não uma tabela separada) — um novo pedido de
// redefinição invalida automaticamente o anterior.
//
// Uso: node --env-file=.env setup-password-reset.mjs
//
// O que faz:
//   1. Adiciona "User"."resetTokenHash" (text, nullable) se não existir.
//   2. Adiciona "User"."resetTokenExpiresAt" (timestamptz, nullable) se
//      não existir.
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente. Rodar ANTES
// de subir o código que depende dessas colunas (server/auth.js).
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
  console.log("== Colunas de redefinição de senha por e-mail (achado B14) ==");
  await ensureColumn("User", "resetTokenHash", `ALTER TABLE "User" ADD COLUMN "resetTokenHash" text`);
  await ensureColumn("User", "resetTokenExpiresAt", `ALTER TABLE "User" ADD COLUMN "resetTokenExpiresAt" timestamptz`);

  console.log("\nConcluído. Nenhum dado existente foi alterado.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
