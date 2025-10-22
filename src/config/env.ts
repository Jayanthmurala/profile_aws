import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4002),
  DATABASE_URL: requireEnv("DATABASE_URL"),

  AUTH_JWKS_URL: process.env.AUTH_JWKS_URL ?? "https://authaws-production.up.railway.app/.well-known/jwks.json",
  AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER ?? "nexus-auth",
  AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE ?? "nexus",
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL ?? "https://authaws-production.up.railway.app",
  
  NETWORK_SERVICE_URL: process.env.NETWORK_SERVICE_URL ?? "http://localhost:4005",
  BADGE_AUTO_POST_ENABLED: process.env.BADGE_AUTO_POST_ENABLED !== "false",
  
  // System authentication for inter-service communication
  SYSTEM_SECRET: process.env.SYSTEM_SECRET ?? "default-system-secret-change-in-production",
  SYSTEM_JWT_SECRET: process.env.SYSTEM_JWT_SECRET ?? "system-jwt-secret-change-in-production",
  
  // Redis configuration for caching and rate limiting
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  REDIS_ENABLED: process.env.REDIS_ENABLED !== "false",
};
