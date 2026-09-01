import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 10,
});

try {
  const result = await sql.unsafe(
    "select current_database() as db, current_user as usr, now() as now"
  );

  console.log(result);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
