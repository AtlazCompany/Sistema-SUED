import postgres from "postgres";
import { config } from "./config.js";

// Cliente ÚNICO do banco (Postgres do Supabase). Nenhum módulo cria outro.
// Todos os acessos ao banco passam por este `sql`.
export const sql = postgres(config.databaseUrl, {
  ssl: "require",
  max: 10, // tamanho do pool
  idle_timeout: 20,
  connect_timeout: 30,
});
