import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { sql } from "./supabaseClient.js";
import { config } from "./config.js";
import { asyncHandler, HttpError } from "./utils.js";
import { sendPasswordResetEmail } from "./mail.js";
import { logAudit } from "./audit.js";

export const authRouter = Router();

// ---- Rate limit do login (em memória, sem dependência nova) ----
// Conta tentativas malsucedidas por IP numa janela de tempo; zera ao logar
// com sucesso. Não distingue "e-mail não existe" de "senha errada" — ambos
// contam igual e a mensagem de erro continua a mesma de sempre.
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map(); // ip -> { count, windowStart }

function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && now - entry.windowStart < LOGIN_WINDOW_MS && entry.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((LOGIN_WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Muitas tentativas de login. Tente novamente em alguns minutos." });
  }
  next();
}

function registerFailedLogin(req) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearLoginAttempts(req) {
  loginAttempts.delete(req.ip);
}

// ---- Rate limit de troca da própria senha (mesmo padrão do login) ----
// Diferente do login, aqui já existe um usuário autenticado (passou por
// requireAuth antes) — a chave é o id do usuário, não o IP, para não
// punir todo mundo atrás do mesmo IP/proxy por causa de uma única conta
// sob ataque (ex.: cookie de sessão roubado, tentando adivinhar a senha
// atual). Só tentativas de senha atual ERRADA contam — erro de validação
// (senha curta, confirmação ausente/diferente) não é uma tentativa de
// adivinhação e não deveria consumir a cota.
const PASSWORD_CHANGE_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const PASSWORD_CHANGE_MAX_ATTEMPTS = 8;
const passwordChangeAttempts = new Map(); // userId -> { count, windowStart }

function passwordChangeRateLimit(req, res, next) {
  const key = req.user.id;
  const now = Date.now();
  const entry = passwordChangeAttempts.get(key);
  if (entry && now - entry.windowStart < PASSWORD_CHANGE_WINDOW_MS && entry.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((PASSWORD_CHANGE_WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Muitas tentativas de troca de senha. Tente novamente em alguns minutos." });
  }
  next();
}

function registerFailedPasswordChange(req) {
  const key = req.user.id;
  const now = Date.now();
  const entry = passwordChangeAttempts.get(key);
  if (!entry || now - entry.windowStart >= PASSWORD_CHANGE_WINDOW_MS) {
    passwordChangeAttempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearPasswordChangeAttempts(req) {
  passwordChangeAttempts.delete(req.user.id);
}

// ---- Rate limit de recuperação de senha por e-mail (achado B14) ----
// Diferente do login/troca de senha, aqui TODA chamada conta contra a cota
// (não só falhas) — a resposta é sempre a mesma exista ou não o e-mail
// (proteção contra enumeração de contas, ver rota /esqueci-senha), então
// não há como distinguir "tentativa legítima" de "abuso" além da própria
// frequência. Duas chaves: por e-mail (evita spammar a caixa de entrada de
// uma vítima) e por IP (evita abuso em escala).
const RESET_REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const RESET_REQUEST_MAX_PER_EMAIL = 3;
const RESET_REQUEST_MAX_PER_IP = 8;
const resetRequestByEmail = new Map();
const resetRequestByIp = new Map();
// Rota de confirmação (gasta o token) — o espaço do token (256 bits) já
// torna força bruta inviável; o limite por IP aqui é só defesa em
// profundidade, generoso o bastante para não atrapalhar alguém digitando a
// senha errado algumas vezes.
const RESET_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
const RESET_CONFIRM_MAX_PER_IP = 20;
const resetConfirmByIp = new Map();

function withinLimit(map, key, windowMs, max) {
  const now = Date.now();
  const entry = map.get(key);
  if (entry && now - entry.windowStart < windowMs) {
    if (entry.count >= max) return false;
    entry.count += 1;
  } else {
    map.set(key, { count: 1, windowStart: now });
  }
  return true;
}

// Achado B21 (Fase 5): entradas de rate limit só saem do Map em caso de
// sucesso (ou, para recuperação de senha, nunca) — uma tentativa vinda de
// uma chave (IP/usuário/e-mail) que nunca mais aparece fica órfã para
// sempre. Varredura periódica evita crescimento sem limite ao longo da
// vida do processo.
const RATE_LIMIT_SWEEP_MS = 10 * 60 * 1000; // 10 minutos
function sweepExpired(map, windowMs) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.windowStart >= windowMs) map.delete(key);
  }
}
setInterval(() => {
  sweepExpired(loginAttempts, LOGIN_WINDOW_MS);
  sweepExpired(passwordChangeAttempts, PASSWORD_CHANGE_WINDOW_MS);
  sweepExpired(resetRequestByEmail, RESET_REQUEST_WINDOW_MS);
  sweepExpired(resetRequestByIp, RESET_REQUEST_WINDOW_MS);
  sweepExpired(resetConfirmByIp, RESET_CONFIRM_WINDOW_MS);
}, RATE_LIMIT_SWEEP_MS).unref();

function sign(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    config.jwtSecret,
    { expiresIn: config.tokenMaxAge },
  );
}

function setCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: config.tokenMaxAge * 1000,
    path: "/",
  });
}

// POST /api/auth/login
authRouter.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw new HttpError(400, "Informe e-mail e senha.");

    const [user] = await sql`
      select id, name, email, role, active, "passwordHash", "tokenVersion"
      from "User" where email = ${String(email).trim().toLowerCase()} limit 1`;

    if (!user || !user.active || !user.passwordHash) {
      registerFailedLogin(req);
      throw new HttpError(401, "E-mail ou senha inválidos.");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      registerFailedLogin(req);
      throw new HttpError(401, "E-mail ou senha inválidos.");
    }

    clearLoginAttempts(req);
    setCookie(res, sign(user));
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }),
);

// POST /api/auth/logout
authRouter.post("/logout", (req, res) => {
  res.clearCookie(config.cookieName, { path: "/" });
  res.json({ ok: true });
});

// GET /api/auth/me — mesma revalidação contra o banco de requireAuth
// (resolveSession), mas sem exigir sessão: usuário nulo é uma resposta
// válida aqui (o front usa isso para decidir se mostra a tela de login),
// não um erro. Um usuário desativado/excluído nunca é considerado "logado".
authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[config.cookieName];
    const session = await resolveSession(token);
    res.json({ user: session.ok ? session.user : null });
  }),
);

// PUT /api/auth/senha — o próprio usuário troca a sua senha (exige a atual).
authRouter.put(
  "/senha",
  requireAuth,
  passwordChangeRateLimit,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) throw new HttpError(400, "Informe a senha atual e a nova senha.");
    if (String(newPassword).length < 8) throw new HttpError(400, "A nova senha deve ter pelo menos 8 caracteres.");
    if (!confirmNewPassword) throw new HttpError(400, "Confirme a nova senha.");
    if (String(newPassword) !== String(confirmNewPassword))
      throw new HttpError(400, "A confirmação da senha não confere.");

    const [user] = await sql`
      select id, name, email, role, "passwordHash", "tokenVersion" from "User" where id = ${req.user.id}`;
    if (!user) throw new HttpError(404, "Usuário não encontrado.");

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      registerFailedPasswordChange(req);
      throw new HttpError(401, "Senha atual incorreta.");
    }
    clearPasswordChangeAttempts(req);

    const passwordHash = await bcrypt.hash(String(newPassword), 12);
    // Achado B7: incrementa tokenVersion na MESMA atualização — qualquer
    // sessão emitida antes desta troca (outro dispositivo/aba já logado)
    // deixa de ser aceita por resolveSession() na próxima requisição dela,
    // mesmo ainda dentro do prazo de validade do JWT (8h).
    const [{ tokenVersion }] = await sql`
      update "User" set "passwordHash" = ${passwordHash}, "tokenVersion" = "tokenVersion" + 1
      where id = ${user.id} returning "tokenVersion"`;

    // Renova o cookie da sessão ATUAL com a nova tokenVersion — só essa aba
    // continua funcionando sem precisar logar de novo; qualquer outra já
    // fica de fora a partir de agora.
    setCookie(res, sign({ ...user, tokenVersion }));
    res.json({ ok: true });
  }),
);

// Achado B14 (Fase 5): recuperação de senha por e-mail.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos

// POST /api/auth/esqueci-senha — SEMPRE responde igual, exista ou não o
// e-mail, esteja a conta ativa ou não, mesmo se a cota de rate limit foi
// estourada: nunca revela nada sobre a existência de uma conta.
authRouter.post(
  "/esqueci-senha",
  asyncHandler(async (req, res) => {
    const respond = () => res.json({ ok: true, message: "Se o e-mail existir, enviaremos instruções para redefinir a senha." });
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : "";
    if (!email) return respond();

    const emailOk = withinLimit(resetRequestByEmail, email, RESET_REQUEST_WINDOW_MS, RESET_REQUEST_MAX_PER_EMAIL);
    const ipOk = withinLimit(resetRequestByIp, req.ip, RESET_REQUEST_WINDOW_MS, RESET_REQUEST_MAX_PER_IP);
    if (!emailOk || !ipOk) return respond();

    const [user] = await sql`select id, name, email, active from "User" where email = ${email} limit 1`;
    if (user && user.active) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await sql`
        update "User" set "resetTokenHash" = ${tokenHash}, "resetTokenExpiresAt" = ${expiresAt}
        where id = ${user.id}`;
      const resetUrl = `${config.appBaseUrl}/redefinir-senha?token=${rawToken}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
    respond();
  }),
);

// POST /api/auth/redefinir-senha — consome o token (uso único) e grava a
// nova senha. Mensagem de erro genérica, sem diferenciar "token nunca
// existiu" de "expirou" de "já foi usado" (mesma proteção contra
// enumeração da rota acima).
authRouter.post(
  "/redefinir-senha",
  asyncHandler(async (req, res) => {
    const { token, newPassword, confirmNewPassword } = req.body ?? {};
    if (!token || !newPassword || !confirmNewPassword) throw new HttpError(400, "Preencha todos os campos.");
    if (String(newPassword).length < 8) throw new HttpError(400, "A nova senha deve ter pelo menos 8 caracteres.");
    if (String(newPassword) !== String(confirmNewPassword))
      throw new HttpError(400, "A confirmação da senha não confere.");

    if (!withinLimit(resetConfirmByIp, req.ip, RESET_CONFIRM_WINDOW_MS, RESET_CONFIRM_MAX_PER_IP))
      throw new HttpError(429, "Muitas tentativas. Tente novamente em alguns minutos.");

    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const [user] = await sql`
      select id, name from "User"
      where "resetTokenHash" = ${tokenHash} and "resetTokenExpiresAt" > now()`;
    if (!user) throw new HttpError(400, "Link inválido ou expirado.");

    const passwordHash = await bcrypt.hash(String(newPassword), 12);
    await sql`
      update "User" set "passwordHash" = ${passwordHash}, "tokenVersion" = "tokenVersion" + 1,
        "resetTokenHash" = null, "resetTokenExpiresAt" = null
      where id = ${user.id}`;
    // Achado B9: mesmo tratamento de auditoria de uma redefinição feita por
    // um admin — before/after null de propósito (nada sensível a gravar), o
    // próprio registro (quem, quando) já é o valor de auditoria. Aqui "quem
    // fez" é o próprio usuário (provou posse do e-mail via o token).
    await logAudit(sql, { table: "User", recordId: user.id, action: "UPDATE", user: { id: user.id, name: user.name }, before: null, after: null });
    res.json({ ok: true });
  }),
);

// Resolve a sessão a partir do cookie: valida o JWT (identifica QUEM é o
// usuário) e depois recarrega o registro atual no banco (fonte de verdade
// para active/role/nome/e-mail) — nunca confia em active/role vindos do
// token, que podem estar desatualizados por até 8h (TTL do JWT). Nunca
// seleciona passwordHash. Usada por requireAuth e por GET /me, para não
// duplicar a lógica em dois lugares.
async function resolveSession(token) {
  if (!token) return { ok: false, reason: "no_token" };

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return { ok: false, reason: "invalid_token" };
  }

  const [user] = await sql`
    select id, name, email, role, active, "tokenVersion" from "User" where id = ${payload.id}`;
  if (!user) return { ok: false, reason: "not_found" };
  if (!user.active) return { ok: false, reason: "inactive" };
  // Achado B7 (Fase 5): trocar a senha (própria ou por um admin redefinindo a
  // de outro usuário) incrementa "tokenVersion" no banco — qualquer JWT
  // emitido ANTES disso carrega a versão antiga e passa a ser rejeitado
  // aqui, mesmo ainda dentro do prazo de validade (8h). `?? 0` dos dois
  // lados preserva tokens emitidos antes desta funcionalidade existir (sem
  // a claim) — eles continuam valendo contra uma coluna nova que também
  // começa em 0, em vez de deslogar todo mundo no dia do deploy.
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) return { ok: false, reason: "stale_token" };

  return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

const SESSION_ERROR_MESSAGES = {
  no_token: "Não autenticado.",
  invalid_token: "Sessão expirada.",
  not_found: "Sessão inválida. Faça login novamente.",
  inactive: "Sua conta foi desativada. Fale com um administrador.",
  stale_token: "Sua senha foi alterada. Faça login novamente.",
};

// Middleware: exige sessão válida E usuário atualmente ativo no banco.
// req.user é sempre reconstruído a partir do banco (nunca do JWT antigo),
// então uma desativação ou troca de papel feita por um admin passa a valer
// já na próxima requisição do usuário afetado — sem precisar de logout.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  let session;
  try {
    session = await resolveSession(token);
  } catch (e) {
    // Nunca logar o erro completo (pode conter detalhes de conexão) — só a
    // mensagem, e nunca dados de sessão/senha.
    console.error("requireAuth: falha ao consultar o usuário no banco:", e.message);
    return res.status(500).json({ error: "Erro interno." });
  }
  if (!session.ok) return res.status(401).json({ error: SESSION_ERROR_MESSAGES[session.reason] });
  req.user = session.user;
  next();
}

// Middleware: exige um dos papéis informados.
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: "Sem permissão." });
    next();
  };
