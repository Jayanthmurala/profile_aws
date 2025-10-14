import { FastifyRequest, FastifyReply } from "fastify";
import { MetricsLogger, generateCorrelationId } from "../utils/logger.js";

/**
 * Request logging middleware for production monitoring
 * Tracks performance, errors, and user behavior
 */

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    startTime: number;
  }
}

export function requestLoggingMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Generate correlation ID for request tracking
    request.correlationId = generateCorrelationId();
    request.startTime = Date.now();

    // Add correlation ID to response headers
    reply.header('X-Correlation-ID', request.correlationId);

    // Log request start
    request.log.info({
      type: 'request_start',
      method: request.method,
      url: request.url,
      correlationId: request.correlationId,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      userId: (request as any).user?.sub
    }, `Request started: ${request.method} ${request.url}`);

    // CRITICAL FIX: Return to allow request to continue
    return;
  };
}

/**
 * Database query logging hook
 */
export function createDatabaseLogger() {
  return {
    beforeQuery: (query: string) => {
      const startTime = Date.now();
      return { startTime, query };
    },
    
    afterQuery: (context: { startTime: number; query: string }, result?: any, error?: Error) => {
      const duration = Date.now() - context.startTime;
      const rowCount = result?.length || result?.count || 0;
      
      MetricsLogger.logDatabaseQuery(
        context.query,
        duration,
        rowCount,
        error
      );
    }
  };
}

/**
 * Performance monitoring for critical operations
 */
export class OperationTimer {
  private startTime: number;
  private operation: string;
  private context: Record<string, any>;

  constructor(operation: string, context: Record<string, any> = {}) {
    this.operation = operation;
    this.context = context;
    this.startTime = Date.now();
  }

  finish(additionalContext: Record<string, any> = {}) {
    const duration = Date.now() - this.startTime;
    
    const logData = {
      type: 'operation_performance',
      operation: this.operation,
      duration,
      ...this.context,
      ...additionalContext
    };

    if (duration > 2000) {
      console.warn(logData, `Slow operation: ${this.operation} (${duration}ms)`);
    } else {
      console.debug(logData, `Operation completed: ${this.operation} (${duration}ms)`);
    }

    return duration;
  }
}

/**
 * User behavior tracking
 */
export class UserBehaviorLogger {
  static logUserAction(
    userId: string,
    action: string,
    resource: string,
    metadata: Record<string, any> = {},
    correlationId?: string
  ) {
    console.info({
      type: 'user_behavior',
      userId,
      action,
      resource,
      metadata,
      correlationId,
      timestamp: new Date().toISOString()
    }, `User action: ${userId} ${action} ${resource}`);
  }

  static logFeatureUsage(
    userId: string,
    feature: string,
    duration?: number,
    correlationId?: string
  ) {
    console.info({
      type: 'feature_usage',
      userId,
      feature,
      duration,
      correlationId,
      timestamp: new Date().toISOString()
    }, `Feature used: ${feature} by ${userId}`);
  }
}

export { MetricsLogger, generateCorrelationId };
