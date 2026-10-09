// Script de configuração ÚNICA e IDEMPOTENTE — impostos no orçamento (20%).
//
// O que faz: adiciona a coluna "taxRatePercent" (integer, not null, default 0)
// em "Budget". O default 0 mantém os orçamentos JÁ existentes exatamente como
// estavam (nenhum total antigo muda). Orçamentos criados ou salvos a partir
// de agora recebem 20%, definido pelo servidor (public/src/budget-math.js).
//
// Uso (rode server/backup-db.mjs ANTES):
//   node --env-file=.env setup-budget-tax.mjs
//
// NÃO apaga nenhum dado. Reversível:
//   ALTER TABLE "Budget" DROP COLUMN "taxRatePercent";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

try {
  const [{ exists }] = await sql`
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'Budget' and column_name = 'taxRatePercent'
    ) as exists`;

  if (exists) {
    console.log('- coluna "Budget"."taxRatePercent" já existe, nada a fazer.');
  } else {
    await sql`alter table "Budget" add column "taxRatePercent" integer not null default 0`;
    console.log('+ coluna "taxRatePercent" criada (orçamentos existentes ficam com 0%).');
  }

  console.log("\nConcluído.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
