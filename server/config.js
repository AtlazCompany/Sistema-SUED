// Configurações centralizadas do backend. Nenhum outro arquivo lê process.env.
const port = Number(process.env.PORT) || 4000;

export const config = {
  port,
  jwtSecret: process.env.JWT_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  isProd: process.env.NODE_ENV === "production",
  cookieName: "sued_token",
  tokenMaxAge: 60 * 60 * 8, // 8h em segundos
  // Achado B14 (Fase 5): opcionais — sem RESEND_API_KEY, o e-mail de
  // redefinição de senha cai em modo de desenvolvimento (link registrado no
  // console em vez de enviado), sem quebrar o fluxo. Ver server/mail.js.
  resendApiKey: process.env.RESEND_API_KEY || null,
  mailFrom: process.env.MAIL_FROM || "onboarding@resend.dev",
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
};

if (!config.jwtSecret) throw new Error("JWT_SECRET ausente no .env");
if (!config.databaseUrl) throw new Error("DATABASE_URL ausente no .env");
