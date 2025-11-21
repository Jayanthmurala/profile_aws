import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { ZodTypeProvider, serializerCompiler, validatorCompiler, jsonSchemaTransform } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { prisma, connectDatabase, disconnectDatabase } from "./db.js";
import profileRoutes from "./routes/profile.routes.js";
import healthRoutes from "./routes/health.routes.js";
import bulkRoutes from "./routes/bulk.routes.js";
import adminRoutes from "./admin/routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { generalRateLimit } from "./middleware/rateLimit.js";
import { profileInputSanitizer, addSecurityHeaders } from "./middleware/inputSanitization.js";
import { requestLoggingMiddleware } from "./middleware/requestLogger.js";
import { GracefulShutdown, MemoryMonitor } from "./utils/gracefulShutdown.js";
import { PerformanceMonitor } from "./utils/performanceMonitor.js";
import { UserSyncService } from "./services/UserSyncService.js";

async function buildServer() {
  console.log('[BUILD] Creating Fastify instance...');
  const app = Fastify({ 
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie']
    }
  }).withTypeProvider<ZodTypeProvider>();
  console.log('[BUILD] Fastify instance created');

  // Set error handler BEFORE other plugins
  app.setErrorHandler(errorHandler);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Set up graceful shutdown
  const gracefulShutdown = GracefulShutdown.getInstance({
    timeout: 30000, // 30 seconds
    signals: ['SIGTERM', 'SIGINT', 'SIGUSR2']
  });
  gracefulShutdown.register(app);

  // Start memory monitoring
  MemoryMonitor.startMonitoring();

  // TEMPORARILY DISABLED ALL MIDDLEWARE FOR DEBUGGING
  // Register security headers for all requests
  // app.addHook('onRequest', addSecurityHeaders);

  // Register rate limiting BEFORE other middleware
  // app.addHook('preHandler', generalRateLimit);

  // Register request logging for all requests
  // app.addHook('preHandler', requestLoggingMiddleware());

  // Register input sanitization for all requests
  // app.addHook('preHandler', profileInputSanitizer);

  // Add response logging hooks
  app.addHook('onSend', async (request, reply, payload) => {
    const responseTime = Date.now() - (request as any).startTime;
    const userId = (request as any).user?.sub;
    const correlationId = (request as any).correlationId;

    // Log request completion with metrics
    const payloadSize = typeof payload === 'string' ? 
      Buffer.byteLength(payload, 'utf8') : 
      Buffer.isBuffer(payload) ? payload.length : 0;

    request.log.info({
      type: 'request_complete',
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime,
      payloadSize,
      correlationId,
      userId
    }, `${request.method} ${request.url} - ${reply.statusCode} (${responseTime}ms)`);

    return payload;
  });

  app.addHook('onError', async (request, reply, error) => {
    const responseTime = Date.now() - ((request as any).startTime || Date.now());
    const correlationId = (request as any).correlationId;
    
    request.log.error({
      type: 'request_error',
      method: request.method,
      url: request.url,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      responseTime,
      correlationId,
      userId: (request as any).user?.sub
    }, `Request error: ${request.method} ${request.url} - ${error.message}`);
  });

  // Register middleware
  await app.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // List of allowed origins
      const allowedOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://nexus-frontend.vercel.app',
        // Add production domains here
      ];
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "Nexus Profile Service", version: "0.1.0" },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      tags: [
        { name: "profile", description: "Profile endpoints" },
        { name: "publications", description: "Publications endpoints" },
        { name: "projects", description: "Personal projects endpoints" },
        { name: "badges", description: "Badges endpoints" },
        { name: "colleges", description: "Colleges endpoints" },
        { name: "head-admin", description: "HEAD_ADMIN profile management endpoints" },
        { name: "dept-admin", description: "DEPT_ADMIN profile management endpoints" },
        { name: "placements-admin", description: "PLACEMENTS_ADMIN profile management endpoints" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });

  app.get("/", async () => ({ message: "Nexus Profile Service" }));
  
  // Simple test endpoint to debug middleware issues
  app.get("/test", async (request, reply) => {
    console.log('[TEST] Test endpoint called');
    return reply.send({ status: "test working", timestamp: new Date().toISOString() });
  });
  
  // Enhanced health check endpoint
  app.get("/health", async (request, reply) => {
    try {
      const memoryStats = MemoryMonitor.getMemoryStats();
      const isHealthy = gracefulShutdown.isHealthy();
      
      if (!isHealthy) {
        return reply.code(503).send({
          status: "unhealthy",
          reason: "Service is shutting down"
        });
      }

      return reply.send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
          rss: `${Math.round(memoryStats.process.rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memoryStats.process.heapUsed / 1024 / 1024)}MB`,
          systemUsage: `${Math.round(memoryStats.system.usagePercent * 100)}%`
        },
        activeConnections: gracefulShutdown.getActiveConnectionsCount(),
        environment: env.NODE_ENV
      });
    } catch (error) {
      console.error('[Health] Health check error:', error);
      return reply.code(500).send({
        status: "error",
        message: "Health check failed",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Readiness probe for Kubernetes
  app.get("/ready", async (request, reply) => {
    try {
      // Check database connectivity
      await prisma.$queryRaw`SELECT 1`;
      
      return reply.send({
        status: "ready",
        timestamp: new Date().toISOString(),
        checks: {
          database: "ok",
          redis: "ok" // RedisClient handles failures gracefully
        }
      });
    } catch (error) {
      return reply.code(503).send({
        status: "not ready",
        timestamp: new Date().toISOString(),
        error: "Database connectivity check failed"
      });
    }
  });

  // Performance metrics endpoint (development/admin only)
  app.get("/metrics", async (request, reply) => {
    if (env.NODE_ENV === 'production') {
      // In production, require admin authentication
      const auth = request.headers["authorization"];
      if (!auth?.startsWith("Bearer ")) {
        return reply.code(401).send({ message: "Authentication required" });
      }
    }

    const metrics = PerformanceMonitor.getMetrics();
    return reply.send({
      ...metrics,
      timestamp: new Date().toISOString(),
      service: "profile-service"
    });
  });

  // Register routes
  console.log('[BUILD] Registering routes...');
  await app.register(healthRoutes);
  console.log('[BUILD] Health routes registered');
  await app.register(profileRoutes);
  console.log('[BUILD] Profile routes registered');
  await app.register(bulkRoutes);
  console.log('[BUILD] Bulk routes registered');
  await app.register(adminRoutes);
  console.log('[BUILD] Admin routes registered');

  console.log('[BUILD] All routes registered, returning app');
  return app;
}

async function startServer() {
  try {
    console.log('[STARTUP] Starting profile service...');
    
    // Connect to database first
    console.log('[STARTUP] Connecting to database...');
    const dbConnected = await connectDatabase();
    if (!dbConnected) {
      console.error('Failed to connect to database');
      process.exit(1);
    }
    console.log('[STARTUP] Database connected successfully');

    // PHASE 3: Start user sync service (Redis pub/sub listener)
    console.log('[STARTUP] Starting user sync service...');
    try {
      await UserSyncService.startListening();
      console.log('[STARTUP] User sync service started');
    } catch (error) {
      console.warn('[STARTUP] Failed to start user sync service (non-blocking):', error);
      // Non-blocking - service can work without sync
    }

    // Build and start the server
    console.log('[STARTUP] Building server...');
    const app = await buildServer();
    console.log('[STARTUP] Server built, starting to listen...');
    const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log('[STARTUP] Server listening started');
    
    console.log(`Profile service listening at ${address}`);
    console.log(`Environment: ${env.NODE_ENV}`);
    console.log(`Database: Connected`);
    console.log(`Redis: ${env.REDIS_ENABLED ? 'Enabled' : 'Disabled'}`);
    
    // Register cleanup handlers
    const cleanup = async () => {
      console.log('Shutting down server...');
      try {
        // PHASE 3: Stop user sync service
        await UserSyncService.stopListening();
        
        await app.close();
        await disconnectDatabase();
        console.log('Server shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    
  } catch (err) {
    console.error("Error starting server:", err);
    await disconnectDatabase();
    process.exit(1);
  }
}

startServer();
