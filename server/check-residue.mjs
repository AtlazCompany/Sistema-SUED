// Varredura de resíduo de dados de teste — TODAS as tabelas, TODAS as
// colunas onde texto pode aparecer, incluindo JSONB (before/after do
// AuditLog), não só text/varchar.
//
// Achado real (01/09/2026): as varreduras anteriores desta auditoria só
// checavam colunas text/character varying — nunca as colunas jsonb
// (AuditLog.before/after), que acumularam 242 registros de teste ao
// longo dos Lotes 4-8 sem serem detectados. Este script corrige isso
// definitivamente, pra ser reutilizado em qualquer checagem futura.
//
// Uso: node --env-file=.env check-residue.mjs [padrao1] [padrao2] ...
// Sem argumentos, usa os padrões padrão do projeto (AUDIT-FASE, audit.fase).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2 });
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : ["AUDIT-FASE", "audit.fase"];

const tables = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'`;

let residueFound = false;
for (const { table_name: t } of tables) {
  const cols = await sql`select column_name, data_type from information_schema.columns where table_name = ${t}`;
  // text/varchar E jsonb (before/after) — a lacuna corrigida aqui.
  const textCols = cols.filter((c) => ["text", "character varying", "jsonb", "json"].includes(c.data_type)).map((c) => c.column_name);
  for (const col of textCols) {
    for (const pat of patterns) {
      const rows = await sql.unsafe(`select id from "${t}" where "${col}"::text ilike '%${pat.replace(/'/g, "''")}%'`);
      if (rows.length) {
        console.log(`RESIDUO: ${t}.${col} (padrão "${pat}") — ${rows.length} linha(s): ${rows.map((r) => r.id).join(", ")}`);
        residueFound = true;
      }
    }
  }
}

// Verificação adicional específica: AuditLog com userId nulo é sempre
// resíduo de teste NESTE momento do projeto (só o admin real nunca foi
// excluído) — mas isso pode deixar de ser verdade no futuro, se contas
// reais forem desativadas/excluídas. Reportado, não tratado como regra
// fixa.
const nullActor = await sql`select count(*)::int as n from "AuditLog" where "userId" is null`;
if (nullActor[0].n > 0) {
  console.log(`\nATENÇÃO: ${nullActor[0].n} registro(s) em AuditLog com ator já excluído (userId nulo). Confirme manualmente se são resíduo de teste ou usuários reais desativados antes de apagar.`);
}

console.log(residueFound ? "\n>>> RESÍDUO ENCONTRADO <<<" : `\nZero resíduo confirmado em ${tables.length} tabelas (incluindo colunas JSONB).`);

await sql.end();
