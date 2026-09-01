// Script de configuração ÚNICA e IDEMPOTENTE para os achados B3 e B18
// (Fase 5, decisões de regra de negócio do usuário):
//
//   B3  — impede documento (CPF/CNPJ) duplicado em "Client", mesmo sob
//         concorrência. Índice único CONDICIONAL (só quando document
//         não é nulo) — permite múltiplos clientes sem documento
//         preenchido, só bloqueia duplicata real.
//   B18 — marcador de "vigente" em Budget/Contract: no máximo um
//         Orçamento aprovado e um Contrato assinado "vigente" por
//         evento, controlado pela aplicação ao aprovar/assinar.
//
// Uso: node --env-file=.env setup-status-rules.mjs
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente.
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

async function ensureIndex(name, ddl) {
  const [{ exists }] = await sql`select exists(select 1 from pg_indexes where indexname = ${name}) as exists`;
  if (exists) {
    console.log(`- índice "${name}" já existe, nada a fazer.`);
    return;
  }
  await sql.unsafe(ddl);
  console.log(`+ índice "${name}" criado.`);
}

try {
  console.log("== B18: marcador de vigente (Budget/Contract) ==");
  await ensureColumn("Budget", "vigente", `ALTER TABLE "Budget" ADD COLUMN "vigente" boolean NOT NULL DEFAULT false`);
  await ensureColumn("Contract", "vigente", `ALTER TABLE "Contract" ADD COLUMN "vigente" boolean NOT NULL DEFAULT false`);

  console.log("\n== B3: documento (CPF/CNPJ) único, condicional ==");
  await ensureIndex(
    "Client_document_unique_idx",
    `CREATE UNIQUE INDEX "Client_document_unique_idx" ON "Client" ("document") WHERE "document" IS NOT NULL`,
  );

  console.log("\nConcluído. Nenhuma tabela/coluna/dado existente foi alterado.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
