import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { RedisCache } from "../utils/redisClient.js";
import { AuthServiceClient } from "../utils/AuthServiceClient.js";
import { CircuitBreakerManager } from "../utils/circuitBreaker.js";

/**
 * Health Check Routes for Production Monitoring
 * Critical for 10M+ users deployment
 */

export default async function healthRoutes(app: FastifyInstance) {
  
  // Note: Basic /health route is defined in src/index.ts to avoid conflicts

  // Detailed health check with dependencies
  app.get("/health/detailed", {
    schema: {
      tags: ["health"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const checks: any = {
      database: { status: "unknown", responseTime: 0 },
      redis: { status: "unknown", responseTime: 0 },
      authService: { status: "unknown", responseTime: 0 }
    };

    // Check database connection
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: "healthy",
        responseTime: Date.now() - dbStart
      };
    } catch (error) {
      checks.database = {
        status: "unhealthy",
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Database connection failed"
      };
    }

    // Check Redis connection
    const redisStart = Date.now();
    try {
      await RedisCache.get('health-check');
      checks.redis = {
        status: "healthy",
        responseTime: Date.now() - redisStart
      };
    } catch (error) {
      checks.redis = {
        status: "unhealthy",
        responseTime: Date.now() - redisStart,
        error: error instanceof Error ? error.message : "Redis connection failed"
      };
    }

    // Check Auth Service connection
    try {
      const authStart = Date.now();
      const response = await fetch(`${process.env.AUTH_SERVICE_URL}/health`);
      checks.authService = {
        status: response.ok ? "healthy" : "unhealthy",
        responseTime: Date.now() - authStart,
        statusCode: response.status
      };
    } catch (error) {
      checks.authService = {
        status: "unhealthy",
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Auth service connection failed"
      };
    }

    // Determine overall health
    const allHealthy = Object.values(checks).every((check: any) => check.status === "healthy");
    const overallStatus = allHealthy ? "healthy" : "degraded";
    const statusCode = allHealthy ? 200 : 503;

    const health = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: "profile-service",
      version: process.env.npm_package_version || "0.1.0",
      uptime: process.uptime(),
      responseTime: Date.now() - startTime,
      checks,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      }
    };

    return reply.code(statusCode).send(health);
  });

  // Note: /ready and /live routes are defined in src/index.ts to avoid conflicts

  // Circuit breaker status endpoint
  app.get("/health/circuit-breakers", {
    schema: {
      tags: ["health"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    try {
      const stats = CircuitBreakerManager.getAllStats();
      const healthySystems = CircuitBreakerManager.getHealthySystems();
      const unhealthySystems = CircuitBreakerManager.getUnhealthySystems();
      
      const overallHealth = unhealthySystems.length === 0 ? 'healthy' : 'degraded';
      const statusCode = overallHealth === 'healthy' ? 200 : 503;
      
      return reply.code(statusCode).send({
        status: overallHealth,
        timestamp: new Date().toISOString(),
        circuitBreakers: stats,
        summary: {
          total: Object.keys(stats).length,
          healthy: healthySystems.length,
          unhealthy: unhealthySystems.length,
          healthySystems,
          unhealthySystems
        }
      });
    } catch (error) {
      return reply.code(500).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

}
