import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 10,
});

try {
  console.log("\n===== PRIMARY KEYS / UNIQUE / FOREIGN KEYS =====");

  const constraints = await sql.unsafe(`
    select
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name
    from information_schema.table_constraints tc
    left join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    left join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
      and tc.table_schema = ccu.table_schema
    where tc.table_schema = 'public'
    order by
      tc.table_name,
      tc.constraint_type,
      tc.constraint_name,
      kcu.ordinal_position;
  `);

  for (const c of constraints) {
    console.log(
      `${c.table_name} | ${c.constraint_type} | ${c.constraint_name} | ` +
      `${c.column_name ?? "-"} | ` +
      `${c.foreign_table_name ? `${c.foreign_table_name}.${c.foreign_column_name}` : "-"}`
    );
  }

  console.log("\n===== CHECK CONSTRAINTS =====");

  const checks = await sql.unsafe(`
    select
      tc.table_name,
      tc.constraint_name,
      cc.check_clause
    from information_schema.table_constraints tc
    join information_schema.check_constraints cc
      on tc.constraint_name = cc.constraint_name
    where tc.table_schema = 'public'
      and tc.constraint_type = 'CHECK'
    order by tc.table_name, tc.constraint_name;
  `);

  if (checks.length === 0) {
    console.log("Nenhum CHECK constraint encontrado.");
  } else {
    for (const c of checks) {
      console.log(
        `${c.table_name} | ${c.constraint_name} | ${c.check_clause}`
      );
    }
  }

  console.log("\n===== INDEXES =====");

  const indexes = await sql.unsafe(`
    select
      schemaname,
      tablename,
      indexname,
      indexdef
    from pg_indexes
    where schemaname = 'public'
    order by tablename, indexname;
  `);

  for (const i of indexes) {
    console.log(
      `${i.tablename} | ${i.indexname} | ${i.indexdef}`
    );
  }

} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
