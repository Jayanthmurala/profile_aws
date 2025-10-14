import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Production-grade structured logging with correlation IDs
 * Critical for 10M+ users monitoring and debugging
 */

// Log levels for different environments
const LOG_LEVELS = {
  development: 'debug',
  test: 'warn',
  production: 'info'
};

// Create structured logger
export const logger = pino({
  level: LOG_LEVELS[env.NODE_ENV as keyof typeof LOG_LEVELS] || 'info',
  
  // Production formatting
  ...(env.NODE_ENV === 'production' ? {
    // JSON formatting for production log aggregation
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => ({
        ...object,
        service: 'profile-service',
        version: process.env.npm_package_version || '0.1.0',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString()
      })
    }
  } : {
    // Simple formatting for development (no pino-pretty dependency)
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => ({
        ...object,
        service: 'profile-service',
        timestamp: new Date().toISOString()
      })
    }
  }),

  // Redact sensitive information
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'secret',
      'key',
      'email'
    ],
    censor: '[REDACTED]'
  }
});

/**
 * Request correlation ID middleware
 */
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Performance metrics logger
 */
export class MetricsLogger {
  private static metrics: Map<string, {
    count: number;
    totalTime: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
    errors: number;
  }> = new Map();

  static logRequest(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    userId?: string,
    correlationId?: string
  ) {
    const key = `${method} ${url}`;
    const existing = this.metrics.get(key) || {
      count: 0,
      totalTime: 0,
      avgTime: 0,
      minTime: Infinity,
      maxTime: 0,
      errors: 0
    };

    existing.count++;
    existing.totalTime += responseTime;
    existing.avgTime = existing.totalTime / existing.count;
    existing.minTime = Math.min(existing.minTime, responseTime);
    existing.maxTime = Math.max(existing.maxTime, responseTime);
    
    if (statusCode >= 400) {
      existing.errors++;
    }

    this.metrics.set(key, existing);

    // Log request details
    logger.info({
      type: 'request',
      method,
      url,
      statusCode,
      responseTime,
      userId,
      correlationId,
      errorRate: existing.errors / existing.count
    }, `${method} ${url} - ${statusCode} (${responseTime}ms)`);

    // Alert on high error rates
    if (existing.count > 10 && (existing.errors / existing.count) > 0.1) {
      logger.warn({
        type: 'high_error_rate',
        endpoint: key,
        errorRate: existing.errors / existing.count,
        totalRequests: existing.count,
        totalErrors: existing.errors
      }, `High error rate detected for ${key}`);
    }

    // Alert on slow responses
    if (responseTime > 5000) {
      logger.warn({
        type: 'slow_response',
        method,
        url,
        responseTime,
        userId,
        correlationId
      }, `Slow response detected: ${responseTime}ms`);
    }
  }

  static logDatabaseQuery(
    query: string,
    duration: number,
    rowCount?: number,
    error?: Error
  ) {
    const logData = {
      type: 'database_query',
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      duration,
      rowCount,
      error: error?.message
    };

    if (error) {
      logger.error(logData, `Database query failed: ${error.message}`);
    } else if (duration > 1000) {
      logger.warn(logData, `Slow database query: ${duration}ms`);
    } else {
      logger.debug(logData, `Database query completed`);
    }
  }

  static logCacheOperation(
    operation: 'get' | 'set' | 'del' | 'miss' | 'hit',
    key: string,
    duration?: number,
    size?: number
  ) {
    logger.debug({
      type: 'cache_operation',
      operation,
      key: key.substring(0, 50),
      duration,
      size
    }, `Cache ${operation}: ${key}`);
  }

  static logExternalService(
    service: string,
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
    error?: Error
  ) {
    const logData = {
      type: 'external_service',
      service,
      endpoint,
      method,
      statusCode,
      duration,
      error: error?.message
    };

    if (error || statusCode >= 400) {
      logger.error(logData, `External service error: ${service} ${endpoint}`);
    } else if (duration > 3000) {
      logger.warn(logData, `Slow external service: ${service} ${endpoint}`);
    } else {
      logger.info(logData, `External service call: ${service} ${endpoint}`);
    }
  }

  static getMetrics() {
    const summary = {
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      endpoints: Array.from(this.metrics.entries()).map(([endpoint, stats]) => ({
        endpoint,
        ...stats,
        errorRate: stats.errors / stats.count
      }))
    };

    summary.totalRequests = summary.endpoints.reduce((sum, ep) => sum + ep.count, 0);
    summary.totalErrors = summary.endpoints.reduce((sum, ep) => sum + ep.errors, 0);
    summary.avgResponseTime = summary.endpoints.reduce((sum, ep) => sum + ep.avgTime, 0) / summary.endpoints.length || 0;

    return summary;
  }

  static resetMetrics() {
    this.metrics.clear();
  }
}

/**
 * Business logic logger for important events
 */
export class BusinessLogger {
  static logProfileCreated(userId: string, profileId: string, correlationId?: string) {
    logger.info({
      type: 'business_event',
      event: 'profile_created',
      userId,
      profileId,
      correlationId
    }, `Profile created for user ${userId}`);
  }

  static logBadgeAwarded(userId: string, badgeId: string, awardedBy: string, correlationId?: string) {
    logger.info({
      type: 'business_event',
      event: 'badge_awarded',
      userId,
      badgeId,
      awardedBy,
      correlationId
    }, `Badge ${badgeId} awarded to user ${userId}`);
  }

  static logSearchPerformed(userId: string, query: string, resultCount: number, correlationId?: string) {
    logger.info({
      type: 'business_event',
      event: 'search_performed',
      userId,
      query: query.substring(0, 50),
      resultCount,
      correlationId
    }, `Search performed: "${query}" (${resultCount} results)`);
  }

  static logSecurityEvent(
    event: 'auth_failure' | 'rate_limit_exceeded' | 'suspicious_input' | 'unauthorized_access',
    userId?: string,
    details?: Record<string, any>,
    correlationId?: string
  ) {
    logger.warn({
      type: 'security_event',
      event,
      userId,
      details,
      correlationId,
      timestamp: new Date().toISOString()
    }, `Security event: ${event}`);
  }
}

/**
 * Error logger with context
 */
export class ErrorLogger {
  static logError(
    error: Error,
    context: {
      userId?: string;
      endpoint?: string;
      operation?: string;
      correlationId?: string;
      additionalData?: Record<string, any>;
    }
  ) {
    logger.error({
      type: 'application_error',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      ...context
    }, `Application error: ${error.message}`);
  }

  static logValidationError(
    field: string,
    value: any,
    rule: string,
    userId?: string,
    correlationId?: string
  ) {
    logger.warn({
      type: 'validation_error',
      field,
      value: typeof value === 'string' ? value.substring(0, 100) : value,
      rule,
      userId,
      correlationId
    }, `Validation error: ${field} failed ${rule}`);
  }
}

export { logger as default };
