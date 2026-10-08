// GET /api/health — verificação de saúde, pública e sem dados.
// Usada pelo monitoramento agendado (.github/workflows/keepalive.yml), que
// a chama todo dia: além de avisar se o sistema cair, a consulta mantém o
// projeto Supabase (plano Free) ativo — ele pausa após dias sem uso.
// Nunca devolve detalhe do erro (só o log do servidor recebe).
import { Router } from "express";
import { sql } from "../supabaseClient.js";

export const healthRouter = Router();

const TIMEOUT_MS = 10_000;

healthRouter.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let timer;
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout de ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[health] banco indisponível:", err.message);
    res.status(503).json({ ok: false });
  } finally {
    clearTimeout(timer);
  }
});
