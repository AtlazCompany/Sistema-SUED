// Configurações centralizadas do backend. Nenhum outro arquivo lê process.env.
export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  isProd: process.env.NODE_ENV === "production",
  cookieName: "sued_token",
  tokenMaxAge: 60 * 60 * 8, // 8h em segundos
};

if (!config.jwtSecret) throw new Error("JWT_SECRET ausente no .env");
if (!config.databaseUrl) throw new Error("DATABASE_URL ausente no .env");
