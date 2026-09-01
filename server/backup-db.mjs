// Backup manual do banco (mitigação temporária: plano Free do Supabase
// não inclui backup automático). Exporta TODAS as linhas de TODAS as
// tabelas do schema public para um único arquivo JSON, com timestamp.
//
// Uso: node --env-file=.env backup-db.mjs
//
// O arquivo sai em server/backups/ (já ignorado pelo .gitignore — nunca
// é commitado, já que pode conter dado real de cliente). Cada backup é
// autocontido: tabelas + linhas, na ordem correta pra restaurar depois
// respeitando as chaves estrangeiras (pais antes de filhos).
//
// Isso NÃO substitui um backup de verdade (upgrade pro plano Pago do
// Supabase) — é uma rede de segurança simples até essa decisão ser
// tomada. Rodar manualmente antes de mudanças arriscadas, ou numa
// rotina periódica (ex.: 1x por dia) enquanto não houver backup
// automático.
import postgres from "postgres";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2 });

// Ordem pai→filho, pra restaurar sem violar FK (mesmo raciocínio já
// usado nos testes deste projeto pra limpeza respeitando dependências).
const TABLE_ORDER = [
  "User", "Client", "Contact", "Lead", "Opportunity", "Interaction",
  "EventType", "Venue", "Event",
  "Category", "ProductService", "Supplier", "SupplierProduct",
  "Budget", "BudgetItem", "Contract",
  "Task", "Checklist", "ChecklistItem", "ScheduleItem",
  "AccountPayable", "AccountReceivable", "Transaction",
  "AuditLog",
];

async function main() {
  const allTables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`;
  const known = new Set(TABLE_ORDER);
  const missing = allTables.map((t) => t.table_name).filter((t) => !known.has(t));
  if (missing.length) {
    console.warn("AVISO: tabela(s) nova(s) não listada(s) em TABLE_ORDER, incluída(s) no fim:", missing);
  }
  const order = [...TABLE_ORDER.filter((t) => allTables.some((a) => a.table_name === t)), ...missing];

  const backup = { createdAt: new Date().toISOString(), tables: {} };
  let totalRows = 0;
  for (const table of order) {
    const rows = await sql.unsafe(`select * from "${table}"`);
    backup.tables[table] = rows;
    totalRows += rows.length;
    console.log(`- ${table}: ${rows.length} linha(s)`);
  }

  const dir = path.join(__dirname, "backups");
  await mkdir(dir, { recursive: true });
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filepath = path.join(dir, filename);
  await writeFile(filepath, JSON.stringify(backup, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  console.log(`\nBackup salvo em: ${filepath}`);
  console.log(`Total: ${order.length} tabelas, ${totalRows} linhas.`);
}

main()
  .catch((e) => { console.error("ERRO:", e.message); process.exitCode = 1; })
  .finally(() => sql.end());
