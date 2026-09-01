import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 10,
});

try {
  console.log("\n===== FOREIGN KEYS / DELETE / UPDATE RULES =====");

  const fks = await sql.unsafe(`
    select
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
      and tc.table_schema = ccu.table_schema
    join information_schema.referential_constraints rc
      on tc.constraint_name = rc.constraint_name
      and tc.constraint_schema = rc.constraint_schema
    where tc.table_schema = 'public'
      and tc.constraint_type = 'FOREIGN KEY'
    order by tc.table_name, tc.constraint_name;
  `);

  for (const fk of fks) {
    console.log(
      `${fk.table_name}.${fk.column_name} -> ` +
      `${fk.foreign_table_name}.${fk.foreign_column_name} | ` +
      `UPDATE=${fk.update_rule} | DELETE=${fk.delete_rule}`
    );
  }

  console.log("\n===== TABLE ROW COUNTS =====");

  const tables = await sql.unsafe(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name;
  `);

  for (const table of tables) {
    const name = table.table_name.replace(/"/g, '""');

    const result = await sql.unsafe(
      `select count(*)::int as count from public."${name}"`
    );

    console.log(`${table.table_name} | ${result[0].count} registros`);
  }

} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
