// Monta (ou remonta do zero) o banco LOCAL de testes a partir de
// db/schema.sql — só a estrutura da produção, nenhum dado.
//
// Uso (a partir de server/):  npm run test:setup-db
// Lê DATABASE_URL de .env.test. RECUSA rodar se o banco não for local:
// este script apaga o schema "public" inteiro antes de recriar.
//
// Para atualizar db/schema.sql depois de uma mudança de schema em produção
// (só leitura na produção), ver db/README.md.
import fs from "node:fs";
import postgres from "postgres";
import { isLocalDatabase } from "./tests/db-local.js";

const url = process.env.DATABASE_URL;
if (!isLocalDatabase(url)) {
  console.error("RECUSADO: DATABASE_URL não aponta para um banco local (localhost/127.0.0.1).");
  console.error("Este script apaga o schema inteiro — só roda no banco de testes. Confira server/.env.test.");
  process.exit(1);
}

// Linhas "\restrict"/"\unrestrict" são comandos do psql, não SQL.
const ddl = fs
  .readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.startsWith("\\") && l.trim() !== "CREATE SCHEMA public;")
  .join("\n");

const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("drop schema if exists public cascade; create schema public;");
    await tx.unsafe(ddl);
  });
  const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
  console.log(`Banco de testes pronto: ${n} tabelas, vazio.`);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
