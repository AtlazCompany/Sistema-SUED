// Script de configuração ÚNICA e IDEMPOTENTE para o achado B9 (Fase 5):
// trilha de auditoria técnica. Autorizado explicitamente pelo usuário,
// com escopo definido: Financeiro, Contratos e Usuários (não os outros
// 9 módulos com escrita); retenção indefinida por enquanto (sem expurgo
// automático); entrega só como tabela + consulta técnica direta (sem
// tela própria no sistema).
//
// Uso: node --env-file=.env setup-audit-log.mjs
//
// O que faz:
//   1. Cria a tabela "AuditLog" (aditiva) se ainda não existir — não
//      mexe em nenhuma tabela/coluna existente.
//   2. Cria os 3 índices de consulta (por registro afetado, por quem
//      fez a ação, por data).
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente. Rodar
// ANTES de subir o código que depende de "AuditLog" (server/audit.js).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

async function ensureTable(table, ddl) {
  const [{ exists }] = await sql`
    select exists(
      select 1 from information_schema.tables
      where table_name = ${table}
    ) as exists`;
  if (exists) {
    console.log(`- tabela "${table}" já existe, nada a fazer.`);
    return;
  }
  await sql.unsafe(ddl);
  console.log(`+ tabela "${table}" criada.`);
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
  console.log("== Tabela de trilha de auditoria (achado B9) ==");
  await ensureTable(
    "AuditLog",
    `CREATE TABLE "AuditLog" (
      "id" uuid PRIMARY KEY,
      "table" text NOT NULL,
      "recordId" uuid NOT NULL,
      "action" text NOT NULL,
      "userId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
      "userName" text NOT NULL,
      "before" jsonb,
      "after" jsonb,
      "createdAt" timestamptz NOT NULL
    )`,
  );
  await ensureIndex(
    "AuditLog_table_recordId_idx",
    `CREATE INDEX "AuditLog_table_recordId_idx" ON "AuditLog" ("table", "recordId")`,
  );
  await ensureIndex("AuditLog_userId_idx", `CREATE INDEX "AuditLog_userId_idx" ON "AuditLog" ("userId")`);
  await ensureIndex("AuditLog_createdAt_idx", `CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt")`);

  console.log("\nConcluído. Nenhuma tabela/coluna existente foi alterada.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
