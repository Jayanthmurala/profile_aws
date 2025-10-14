import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { RedisClient } from "./redisClient.js";
import os from "os";

/**
 * Graceful shutdown handler for production reliability
 * Ensures proper cleanup of resources and connections
 */

interface ShutdownOptions {
  timeout?: number; // Shutdown timeout in milliseconds
  signals?: string[]; // Signals to listen for
}

export class GracefulShutdown {
  private static instance: GracefulShutdown;
  private app?: FastifyInstance;
  private isShuttingDown = false;
  private activeConnections = new Set<any>();
  private shutdownTimeout: number;
  private signals: string[];

  constructor(options: ShutdownOptions = {}) {
    this.shutdownTimeout = options.timeout || 30000; // 30 seconds default
    this.signals = options.signals || ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  }

  static getInstance(options?: ShutdownOptions): GracefulShutdown {
    if (!GracefulShutdown.instance) {
      GracefulShutdown.instance = new GracefulShutdown(options);
    }
    return GracefulShutdown.instance;
  }

  register(app: FastifyInstance): void {
    this.app = app;
    
    // Register shutdown handlers for various signals
    this.signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);
        this.shutdown();
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[Shutdown] Uncaught exception:', error);
      this.shutdown(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Shutdown] Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown(1);
    });

    // Track active connections
    app.addHook('onRequest', async (request, reply) => {
      if (this.isShuttingDown) {
        reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Server is shutting down'
        });
        return;
      }
      this.activeConnections.add(request);
    });

    app.addHook('onResponse', async (request, reply) => {
      this.activeConnections.delete(request);
    });

    console.log('[Shutdown] Graceful shutdown handlers registered');
  }

  private async shutdown(exitCode: number = 0): Promise<void> {
    if (this.isShuttingDown) {
      console.log('[Shutdown] Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    console.log('[Shutdown] Starting graceful shutdown process...');

    // Set a timeout for the entire shutdown process
    const shutdownTimer = setTimeout(() => {
      console.error('[Shutdown] Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // Step 1: Stop accepting new connections
      if (this.app) {
        console.log('[Shutdown] Stopping server from accepting new connections...');
        await this.app.close();
      }

      // Step 2: Wait for active connections to finish
      console.log(`[Shutdown] Waiting for ${this.activeConnections.size} active connections to finish...`);
      let waitTime = 0;
      const maxWaitTime = 15000; // 15 seconds max wait for connections
      
      while (this.activeConnections.size > 0 && waitTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitTime += 100;
      }

      if (this.activeConnections.size > 0) {
        console.warn(`[Shutdown] ${this.activeConnections.size} connections still active, proceeding with shutdown`);
      }

      // Step 3: Close database connections
      console.log('[Shutdown] Closing database connections...');
      await prisma.$disconnect();

      // Step 4: Close Redis connections
      console.log('[Shutdown] Closing Redis connections...');
      await RedisClient.disconnect();

      // Step 5: Clear any intervals or timeouts
      console.log('[Shutdown] Clearing timers and intervals...');
      this.clearTimers();

      // Step 6: Final cleanup
      console.log('[Shutdown] Performing final cleanup...');
      await this.performFinalCleanup();

      clearTimeout(shutdownTimer);
      console.log('[Shutdown] Graceful shutdown completed successfully');
      process.exit(exitCode);

    } catch (error) {
      console.error('[Shutdown] Error during graceful shutdown:', error);
      clearTimeout(shutdownTimer);
      process.exit(1);
    }
  }

  private clearTimers(): void {
    // Clear any global timers or intervals
    // This is where you'd clear any setInterval or setTimeout calls
    // that might be running in your application
  }

  private async performFinalCleanup(): Promise<void> {
    // Perform any final cleanup tasks
    // - Clear temporary files
    // - Flush logs
    // - Send final metrics
    // - etc.
    
    try {
      // Example: Clear in-memory caches
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      console.warn('[Shutdown] Error during final cleanup:', error);
    }
  }

  // Method to manually trigger shutdown (useful for testing)
  public triggerShutdown(exitCode: number = 0): void {
    this.shutdown(exitCode);
  }

  // Health check method
  public isHealthy(): boolean {
    return !this.isShuttingDown;
  }

  // Get active connections count
  public getActiveConnectionsCount(): number {
    return this.activeConnections.size;
  }
}

// Memory monitoring utilities
export class MemoryMonitor {
  private static monitoringInterval?: NodeJS.Timeout;
  private static memoryThreshold = 0.9; // 90% memory usage threshold

  static startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      return; // Already monitoring
    }

    console.log('[Memory] Starting memory monitoring...');
    
    this.monitoringInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercent = usedMemory / totalMemory;

      // Log memory stats
      console.log('[Memory] Memory usage:', {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(usage.external / 1024 / 1024)}MB`,
        systemUsage: `${Math.round(memoryUsagePercent * 100)}%`
      });

      // Trigger garbage collection if memory usage is high
      if (memoryUsagePercent > this.memoryThreshold && global.gc) {
        console.warn('[Memory] High memory usage detected, triggering garbage collection');
        global.gc();
      }

      // Alert if memory usage is critically high
      if (memoryUsagePercent > 0.95) {
        console.error('[Memory] CRITICAL: Memory usage above 95%');
      }
    }, intervalMs);
  }

  static stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      console.log('[Memory] Memory monitoring stopped');
    }
  }

  static getMemoryStats() {
    const usage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    return {
      process: {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      },
      system: {
        total: totalMemory,
        free: freeMemory,
        used: totalMemory - freeMemory,
        usagePercent: (totalMemory - freeMemory) / totalMemory
      }
    };
  }
}
