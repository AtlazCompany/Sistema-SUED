import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
});

const tables = await sql`
  select
    table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
  order by table_name;
`;

console.log("\n===== TABELAS DO BANCO =====");
for (const t of tables) {
  console.log(t.table_name);
}

console.log("\n===== COLUNAS =====");

const columns = await sql`
  select
    table_name,
    column_name,
    data_type,
    udt_name,
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position;
`;

let current = "";

for (const c of columns) {
  if (c.table_name !== current) {
    current = c.table_name;
    console.log(`\n--- ${current} ---`);
  }

  console.log(
    `${c.column_name} | ${c.data_type} | ${c.udt_name} | nullable=${c.is_nullable} | default=${c.column_default ?? "-"}`
  );
}

await sql.end();
