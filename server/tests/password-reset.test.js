// Fase 5 — achado B14 (recuperação de senha por e-mail). O módulo
// server/mail.js é substituído por um dublê controlado por teste (node:test
// mock.module) para capturar o link de redefinição sem depender de uma
// conta Resend real (RESEND_API_KEY ainda não configurada neste ambiente —
// sem o mock, o código já cai sozinho no modo de desenvolvimento e só
// registra no console, mas o teste precisa capturar o token
// programaticamente, não fazer parsing de log). Banco real para o resto
// (usuário de teste, colunas resetTokenHash/resetTokenExpiresAt, AuditLog).
//
// Dados prefixados "AUDIT-FASE5-B14-" (removidos ao final). Pula
// graciosamente se não houver conexão com o banco.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const MAIL_URL = pathToFileURL(path.join(import.meta.dirname, "..", "mail.js")).href;
const sentEmails = [];
mock.module(MAIL_URL, {
  exports: {
    sendPasswordResetEmail: async (email, resetUrl) => {
      sentEmails.push({ email, resetUrl });
    },
  },
});

// Importado DEPOIS do mock.module, mesmo padrão de tests/middleware.test.js.
const { authRouter } = await import("../auth.js");

const TAG = "AUDIT-FASE5-B14-";
const TARGET_EMAIL = "audit.fase5.b14-target@sued.local";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
let targetId;

try {
  sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 3, connect_timeout: 5 });
  await sql`select 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

before(async () => {
  if (!dbAvailable) return;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  app.use((err, req, res, _next) => {
    if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
    res.status(err.status || 500).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!dbAvailable) return;
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

function tokenFrom(resetUrl) {
  return new URL(resetUrl).searchParams.get("token");
}

test("recuperação de senha por e-mail (achado B14) — skip sem banco", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  const bcrypt = (await import("bcryptjs")).default;
  targetId = randomUUID();
  await sql`insert into "User" ${sql({
    id: targetId, name: TAG + "Alvo", email: TARGET_EMAIL, role: "OPERACIONAL",
    active: true, passwordHash: await bcrypt.hash("senha-original-123", 10),
  })}`;

  await t.test("POST /esqueci-senha — e-mail inexistente → 200 genérico, nenhum e-mail enviado", async () => {
    const res = await fetch(`${baseUrl}/api/auth/esqueci-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nao.existe.audit.fase5@sued.local" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(sentEmails.length, 0, "e-mail inexistente não deveria disparar envio");
  });

  let rawToken;
  await t.test("POST /esqueci-senha — e-mail existente → 200 (RESPOSTA IDÊNTICA à do caso anterior) + e-mail 'enviado'", async () => {
    const res = await fetch(`${baseUrl}/api/auth/esqueci-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TARGET_EMAIL }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, message: "Se o e-mail existir, enviaremos instruções para redefinir a senha." });
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].email, TARGET_EMAIL);
    rawToken = tokenFrom(sentEmails[0].resetUrl);
    assert.ok(rawToken && rawToken.length === 64, "token deveria ser um hex de 32 bytes (64 chars)");
  });

  await t.test("banco: resetTokenHash gravado é o SHA-256 do token, nunca o token em texto puro", async () => {
    const [row] = await sql`select "resetTokenHash", "resetTokenExpiresAt" from "User" where id = ${targetId}`;
    const expectedHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    assert.equal(row.resetTokenHash, expectedHash);
    assert.notEqual(row.resetTokenHash, rawToken);
    assert.ok(new Date(row.resetTokenExpiresAt) > new Date(), "deveria expirar no futuro");
  });

  await t.test("POST /redefinir-senha — token errado → 400 'Link inválido ou expirado.' (não revela o motivo)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "0".repeat(64), newPassword: "nova-senha-123", confirmNewPassword: "nova-senha-123" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "Link inválido ou expirado.");
  });

  await t.test("POST /redefinir-senha — confirmação diferente → 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, newPassword: "nova-senha-123", confirmNewPassword: "outra-coisa" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("POST /redefinir-senha — token expirado → 400 (mesma mensagem genérica)", async () => {
    await sql`update "User" set "resetTokenExpiresAt" = now() - interval '1 minute' where id = ${targetId}`;
    const res = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, newPassword: "nova-senha-123", confirmNewPassword: "nova-senha-123" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "Link inválido ou expirado.");
    // Restaura a validade para o subteste seguinte, que usa o mesmo token.
    await sql`update "User" set "resetTokenExpiresAt" = now() + interval '30 minutes' where id = ${targetId}`;
  });

  await t.test("POST /redefinir-senha — token válido → 200, senha alterada, sessão antiga invalidada, token consumido (uso único)", async () => {
    const [before] = await sql`select "tokenVersion" from "User" where id = ${targetId}`;
    const res = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, newPassword: "nova-senha-123", confirmNewPassword: "nova-senha-123" }),
    });
    assert.equal(res.status, 200);

    const [after] = await sql`select "passwordHash", "tokenVersion", "resetTokenHash", "resetTokenExpiresAt" from "User" where id = ${targetId}`;
    assert.equal(after.tokenVersion, before.tokenVersion + 1, "achado B7: tokenVersion deveria incrementar (invalida sessões antigas)");
    assert.equal(after.resetTokenHash, null, "token deveria ser consumido (uso único)");
    assert.equal(after.resetTokenExpiresAt, null);
    assert.ok(await bcrypt.compare("nova-senha-123", after.passwordHash), "a nova senha deveria estar em vigor (bcrypt)");

    // Reusar o MESMO token de novo → deveria falhar (já foi consumido).
    const reuse = await fetch(`${baseUrl}/api/auth/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, newPassword: "outra-senha-456", confirmNewPassword: "outra-senha-456" }),
    });
    assert.equal(reuse.status, 400, "o mesmo token não pode ser usado duas vezes");
  });

  await t.test("achado B9 — a redefinição via token gera registro UPDATE em AuditLog para User (before/after null, sem dado sensível)", async () => {
    const [log] = await sql`
      select * from "AuditLog" where "table" = 'User' and "recordId" = ${targetId} and action = 'UPDATE'
      order by "createdAt" desc limit 1`;
    assert.ok(log, "deveria existir um registro de auditoria da redefinição via token");
    assert.equal(log.userId, targetId, "o próprio usuário é quem 'realizou' a ação (provou posse do e-mail)");
    assert.equal(log.before, null);
    assert.equal(log.after, null);
  });

  await t.test("rate limit por e-mail — 4ª chamada em 10min ainda responde 200 genérico, mas não reenvia e-mail", async () => {
    sentEmails.length = 0;
    // já foram feitas 2 chamadas para TARGET_EMAIL acima (fora + dentro do
    // limite) — completa até estourar as 3 permitidas e confirma a 4ª.
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/api/auth/esqueci-senha`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TARGET_EMAIL }),
      });
    }
    const res = await fetch(`${baseUrl}/api/auth/esqueci-senha`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TARGET_EMAIL }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, message: "Se o e-mail existir, enviaremos instruções para redefinir a senha." });
    assert.ok(sentEmails.length < 4, "a cota por e-mail deveria ter bloqueado pelo menos uma das tentativas");
  });

  await t.test("limpeza — nenhum dado AUDIT-FASE5-B14-* residual", async () => {
    await sql`delete from "AuditLog" where "table" = 'User' and "recordId" = ${targetId}`;
    await sql`delete from "User" where id = ${targetId}`;
    const leftoverUser = await sql`select id from "User" where email = ${TARGET_EMAIL}`;
    const leftoverLogs = await sql`select id from "AuditLog" where "recordId" = ${targetId}`;
    assert.equal(leftoverUser.length, 0, "User");
    assert.equal(leftoverLogs.length, 0, "AuditLog");
  });
});
