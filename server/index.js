import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { authRouter } from "./auth.js";
import { clientesRouter } from "./routes/clientes.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { leadsRouter } from "./routes/leads.js";
import { oportunidadesRouter } from "./routes/oportunidades.js";
import { usuariosRouter } from "./routes/usuarios.js";
import { eventosRouter, locaisRouter, tiposEventoRouter } from "./routes/eventos.js";
import { fornecedoresRouter } from "./routes/fornecedores.js";
import { catalogoRouter } from "./routes/catalogo.js";
import { orcamentosRouter, orcamentoPublicoRouter } from "./routes/orcamentos.js";
import { operacionalRouter } from "./routes/operacional.js";
import { financeiroRouter } from "./routes/financeiro.js";
import { contratosRouter } from "./routes/contratos.js";
import { relatoriosRouter } from "./routes/relatorios.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const app = express();

// ---- Middlewares globais ----
app.use(express.json());
app.use(cookieParser());

// ---- Headers de segurança (sem dependência nova) ----
// CSP calibrada para o frontend vanilla atual: permite style inline (o
// helper el() usa o atributo style="" em várias views) e o CSS/fonte do
// Google Fonts carregados em index.html; script só do próprio domínio
// (não há <script> inline nem eval no projeto).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
});

// ---- API ----
app.use("/api/auth", authRouter);
app.use("/api/clientes", clientesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/oportunidades", oportunidadesRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/eventos", eventosRouter);
app.use("/api/locais", locaisRouter);
app.use("/api/tipos-evento", tiposEventoRouter);
app.use("/api/fornecedores", fornecedoresRouter);
app.use("/api/catalogo", catalogoRouter);
app.use("/api/orcamentos", orcamentosRouter);
app.use("/api/orcamento-publico", orcamentoPublicoRouter);
app.use("/api/operacional", operacionalRouter);
app.use("/api/financeiro", financeiroRouter);
app.use("/api/contratos", contratosRouter);
app.use("/api/relatorios", relatoriosRouter);

// ---- Frontend estático (vanilla) ----
app.use(express.static(publicDir));

// SPA fallback: qualquer rota não-API devolve o index.html.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ---- Tratamento central de erros ----
app.use((err, req, res, _next) => {
  // Postgres 22P02 = "invalid text representation" — normalmente um UUID
  // malformado num parâmetro de rota (ex.: GET /api/clientes/id-invalido).
  // Sem isso, viraria 500 com mensagem técnica do driver.
  if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Erro interno." });
});

app.listen(config.port, () => {
  console.log(`SUED backend on http://localhost:${config.port}`);
});
