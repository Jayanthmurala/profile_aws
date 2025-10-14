import { VercelRequest, VercelResponse } from '@vercel/node';
import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "../src/config/env";
import profileRoutes from "../src/routes/profile.routes";

let app: any = null;

async function buildServer() {
  if (app) return app;
  
  const fastify = Fastify({ 
    logger: process.env.NODE_ENV === 'development',
    trustProxy: true 
  });

  await fastify.register(cors, {
    origin: [
      "http://localhost:3000", 
      "http://127.0.0.1:3000", 
      "https://nexus-frontend-pi-ten.vercel.app",
      /\.vercel\.app$/
    ],
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  fastify.get("/", async () => ({ message: "Nexus Profile Service 👤" }));
  fastify.get("/health", async () => ({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "profile"
  }));

  await fastify.register(profileRoutes);

  app = fastify;
  return fastify;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const server = await buildServer();
    await server.ready();
    server.server.emit('request', req, res);
  } catch (error) {
    console.error('Profile service error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
}
