// Script de configuração ÚNICA e IDEMPOTENTE — Lote 9 (ordem dos itens).
//
// Problema: "BudgetItem" não guardava a ordem dos itens. As consultas
// ordenavam pelo id (UUID aleatório), e o PUT recria os itens com ids
// novos — a proposta/PDF mostrava os itens embaralhados, mudando a cada
// salvamento.
//
// O que faz: adiciona a coluna "position" (integer, not null, default 0)
// e um índice ("budgetId", "position"). Itens já existentes recebem a
// posição na ordem em que apareciam até hoje (por id), então nada muda
// visualmente para eles até a próxima edição.
//
// Uso (rode server/backup-db.mjs ANTES):
//   node --env-file=.env setup-budgetitem-position.mjs
//
// NÃO apaga nenhum dado. Reversível:
//   ALTER TABLE "BudgetItem" DROP COLUMN "position";
//   (o índice cai junto com a coluna)
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

try {
  const [{ exists }] = await sql`
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'BudgetItem' and column_name = 'position'
    ) as exists`;

  if (exists) {
    console.log('- coluna "BudgetItem"."position" já existe, nada a fazer.');
  } else {
    await sql.begin(async (tx) => {
      await tx`alter table "BudgetItem" add column "position" integer not null default 0`;
      const updated = await tx`
        update "BudgetItem" bi set "position" = o.rn
        from (
          select id, (row_number() over (partition by "budgetId" order by id) - 1)::int as rn
          from "BudgetItem"
        ) o
        where o.id = bi.id`;
      console.log(`+ coluna "position" criada; ${updated.count} item(ns) existente(s) numerado(s).`);
    });
  }

  const [{ idx }] = await sql`select exists(select 1 from pg_indexes where indexname = 'BudgetItem_budgetId_position_idx') as idx`;
  if (idx) console.log('- índice "BudgetItem_budgetId_position_idx" já existe.');
  else {
    await sql`create index "BudgetItem_budgetId_position_idx" on "BudgetItem" ("budgetId", "position")`;
    console.log('+ índice "BudgetItem_budgetId_position_idx" criado.');
  }

  console.log("\nConcluído.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
