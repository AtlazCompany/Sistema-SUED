import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "./supabaseClient.js";
import { config } from "./config.js";
import { asyncHandler, HttpError } from "./utils.js";

export const authRouter = Router();

function sign(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
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
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw new HttpError(400, "Informe e-mail e senha.");

    const [user] = await sql`
      select id, name, email, role, active, "passwordHash"
      from "User" where email = ${String(email).toLowerCase()} limit 1`;

    if (!user || !user.active || !user.passwordHash)
      throw new HttpError(401, "E-mail ou senha inválidos.");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "E-mail ou senha inválidos.");

    setCookie(res, sign(user));
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }),
);

// POST /api/auth/logout
authRouter.post("/logout", (req, res) => {
  res.clearCookie(config.cookieName, { path: "/" });
  res.json({ ok: true });
});

// GET /api/auth/me
authRouter.get("/me", (req, res) => {
  const token = req.cookies?.[config.cookieName];
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    res.json({ user: { id: payload.id, name: payload.name, email: payload.email, role: payload.role } });
  } catch {
    res.json({ user: null });
  }
});

// Middleware: exige sessão válida.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada." });
  }
}

// Middleware: exige um dos papéis informados.
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: "Sem permissão." });
    next();
  };
