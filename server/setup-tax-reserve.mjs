// Script de configuração ÚNICA e IDEMPOTENTE — reserva de impostos.
//
// O que faz: adiciona 4 colunas (todas com default, nada existente muda):
//   "AccountReceivable"."taxRatePercent" integer not null default 0
//       → % de imposto embutido no valor da conta (0 = sem reserva);
//   "AccountPayable"."isTax" boolean not null default false
//       → a conta é pagamento de imposto (abate a reserva);
//   "Transaction"."taxReserveCents" integer not null default 0
//       → parte do lançamento de ENTRADA que é imposto (reserva gerada);
//   "Transaction"."isTax" boolean not null default false
//       → lançamento de SAIDA que é pagamento de imposto.
// Contas e lançamentos já existentes ficam com 0/false: nenhuma reserva é
// criada retroativamente.
//
// Uso (rode server/backup-db.mjs ANTES):
//   node --env-file=.env setup-tax-reserve.mjs
//
// NÃO apaga nenhum dado. Reversível:
//   ALTER TABLE "AccountReceivable" DROP COLUMN "taxRatePercent";
//   ALTER TABLE "AccountPayable" DROP COLUMN "isTax";
//   ALTER TABLE "Transaction" DROP COLUMN "taxReserveCents", DROP COLUMN "isTax";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, onnotice: () => {} });

const COLUMNS = [
  { table: "AccountReceivable", column: "taxRatePercent", ddl: "integer not null default 0" },
  { table: "AccountPayable", column: "isTax", ddl: "boolean not null default false" },
  { table: "Transaction", column: "taxReserveCents", ddl: "integer not null default 0" },
  { table: "Transaction", column: "isTax", ddl: "boolean not null default false" },
];

try {
  for (const c of COLUMNS) {
    const [{ exists }] = await sql`
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${c.table} and column_name = ${c.column}
      ) as exists`;
    if (exists) console.log(`- coluna "${c.table}"."${c.column}" já existe.`);
    else {
      await sql.unsafe(`alter table "${c.table}" add column "${c.column}" ${c.ddl}`);
      console.log(`+ coluna "${c.table}"."${c.column}" criada.`);
    }
  }
  console.log("\nConcluído.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
