// Script de configuração ÚNICA e IDEMPOTENTE — categorias do Financeiro.
//
// O que faz:
//   - cria a tabela "FinanceCategory" (nome + tipo ENTRADA/SAIDA; nome único
//     por tipo, sem diferenciar maiúsculas) com RLS ligado, como as demais;
//   - adiciona "categoryId" (uuid, opcional, FK para "FinanceCategory") em
//     "AccountReceivable", "AccountPayable" e "Transaction";
//   - se a tabela estiver vazia, cadastra as categorias iniciais.
// Contas e lançamentos já existentes ficam sem categoria.
//
// Uso (rode server/backup-db.mjs ANTES):
//   node --env-file=.env setup-finance-categories.mjs
//
// NÃO apaga nenhum dado. Reversível:
//   ALTER TABLE "AccountReceivable" DROP COLUMN "categoryId";
//   ALTER TABLE "AccountPayable" DROP COLUMN "categoryId";
//   ALTER TABLE "Transaction" DROP COLUMN "categoryId";
//   DROP TABLE "FinanceCategory";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, onnotice: () => {} });

const TABLES = ["AccountReceivable", "AccountPayable", "Transaction"];
const DEFAULTS = [
  ["SAIDA", "Equipe"], ["SAIDA", "Fornecedores"], ["SAIDA", "Aluguel"], ["SAIDA", "Impostos"],
  ["SAIDA", "Marketing"], ["SAIDA", "Retirada / pró-labore"], ["SAIDA", "Outros"],
  ["ENTRADA", "Eventos"], ["ENTRADA", "Outros"],
];

try {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      create table if not exists "FinanceCategory" (
        id uuid primary key,
        name text not null,
        kind text not null constraint "FinanceCategory_kind_check" check (kind in ('ENTRADA', 'SAIDA')),
        "createdAt" timestamptz not null,
        "updatedAt" timestamptz not null
      )`);
    await tx.unsafe(`create unique index if not exists "FinanceCategory_kind_name_key" on "FinanceCategory" (kind, lower(name))`);
    await tx.unsafe(`alter table "FinanceCategory" enable row level security`);
    console.log(`- tabela "FinanceCategory" pronta.`);

    for (const table of TABLES) {
      const [{ exists }] = await tx`
        select exists(
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = 'categoryId'
        ) as exists`;
      if (exists) console.log(`- coluna "${table}"."categoryId" já existe.`);
      else {
        await tx.unsafe(`alter table "${table}" add column "categoryId" uuid
          constraint "${table}_categoryId_fkey" references "FinanceCategory"(id)`);
        console.log(`+ coluna "${table}"."categoryId" criada.`);
      }
    }
    await tx.unsafe(`create index if not exists "Transaction_categoryId_idx" on "Transaction" ("categoryId")`);

    const [{ n }] = await tx`select count(*)::int as n from "FinanceCategory"`;
    if (n > 0) console.log(`- já há ${n} categoria(s); as iniciais não foram cadastradas de novo.`);
    else {
      const now = new Date();
      for (const [kind, name] of DEFAULTS)
        await tx`insert into "FinanceCategory" ${tx({ id: randomUUID(), name, kind, createdAt: now, updatedAt: now })}`;
      console.log(`+ ${DEFAULTS.length} categorias iniciais cadastradas.`);
    }
  });
  console.log("\nConcluído.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
