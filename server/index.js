import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { authRouter } from "./auth.js";
import { clientesRouter } from "./routes/clientes.js";
import { dashboardRouter } from "./routes/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const app = express();

// ---- Middlewares globais ----
app.use(express.json());
app.use(cookieParser());

// ---- API ----
app.use("/api/auth", authRouter);
app.use("/api/clientes", clientesRouter);
app.use("/api/dashboard", dashboardRouter);

// ---- Frontend estático (vanilla) ----
app.use(express.static(publicDir));

// SPA fallback: qualquer rota não-API devolve o index.html.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ---- Tratamento central de erros ----
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Erro interno." });
});

app.listen(config.port, () => {
  console.log(`SUED backend on http://localhost:${config.port}`);
});
