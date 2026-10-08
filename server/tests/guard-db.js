// Trava de segurança dos testes (carregada por `npm test` via --import).
// Os testes criam e apagam dados de verdade. Por padrão eles só podem usar
// um banco LOCAL (o de testes, em Docker — ver server/.env.test). Se o
// DATABASE_URL apontar para outro lugar (ex.: a produção no Supabase), os
// testes que dependem de banco são PULADOS em vez de rodar lá.
// Liberação consciente, só se for mesmo necessário: SUED_ALLOW_REMOTE_TEST_DB=1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLocalDatabase } from "./db-local.js";

if (process.env.DATABASE_URL && !isLocalDatabase(process.env.DATABASE_URL) && process.env.SUED_ALLOW_REMOTE_TEST_DB !== "1") {
  // Endereço que recusa conexão na hora: os testes de banco detectam
  // "sem conexão" e pulam, como já fazem quando não há banco nenhum.
  process.env.DATABASE_URL = "postgres://bloqueado:bloqueado@127.0.0.1:9/bloqueado";
  // Cada arquivo de teste roda num subprocesso (é nele que este --import
  // executa); um marcador por execução (pid do processo pai) faz o aviso
  // sair uma vez só, não uma vez por arquivo.
  let first = true;
  try {
    fs.writeFileSync(path.join(os.tmpdir(), `sued-guard-db-${process.ppid}`), "", { flag: "wx" });
  } catch {
    first = false;
  }
  if (first) {
    console.warn(
      "\n[guard-db] DATABASE_URL não é local — testes de banco PULADOS para não tocar na produção.\n" +
        "[guard-db] Crie server/.env.test apontando para o banco de testes (ver db/README.md).\n",
    );
  }
}
