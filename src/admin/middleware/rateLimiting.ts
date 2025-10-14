import { FastifyRequest, FastifyReply } from 'fastify';
import { BadgeErrorFactory } from '../errors/BadgeServiceErrors.js';
import { RedisRateLimiter } from '../../utils/redisClient.js';

/**
 * Rate limiting middleware for badge operations
 * Implements sliding window rate limiting with different limits per operation type
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
  requests: number[]; // Timestamps of requests for sliding window
}

// In-memory store for rate limiting (in production, use Redis)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limit configurations for different operations
const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  // Badge creation - more restrictive
  'badge-create': {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10, // 10 badge definitions per hour
  },
  
  // Badge awarding - moderate limits
  'badge-award': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 awards per minute
  },
  
  // Badge revocation - moderate limits
  'badge-revoke': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20, // 20 revocations per minute
  },
  
  // Bulk operations - very restrictive
  'badge-bulk': {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 5, // 5 bulk operations per 5 minutes
  },
  
  // Statistics and read operations - more permissive
  'badge-read': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 reads per minute
  },
  
  // Leaderboard - moderate limits due to complexity
  'badge-leaderboard': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20, // 20 leaderboard requests per minute
  }
};

/**
 * Create rate limiting key for a user and operation
 */
function createRateLimitKey(userId: string, operation: string, additionalKey?: string): string {
  const baseKey = `rate_limit:${userId}:${operation}`;
  return additionalKey ? `${baseKey}:${additionalKey}` : baseKey;
}

/**
 * Clean up expired entries from rate limit store
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime <= now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check if request is within rate limit using Redis or in-memory fallback
 */
async function isWithinRateLimit(key: string, config: RateLimitConfig): Promise<{
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}> {
  try {
    // Use Redis-based rate limiting with automatic fallback
    return await RedisRateLimiter.checkRateLimit(key, config.windowMs, config.maxRequests);
  } catch (error) {
    console.error('[RateLimit] Redis rate limit check failed, using in-memory fallback:', error);
    
    // Fallback to in-memory rate limiting
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    let entry = rateLimitStore.get(key);
    
    if (!entry) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
        requests: []
      };
    }
    
    // Remove requests outside the sliding window
    entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);
    entry.count = entry.requests.length;
    
    // Check if within limit
    if (entry.count >= config.maxRequests) {
      const oldestRequest = Math.min(...entry.requests);
      const retryAfter = Math.ceil((oldestRequest + config.windowMs - now) / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: oldestRequest + config.windowMs,
        retryAfter
      };
    }
    
    // Add current request
    entry.requests.push(now);
    entry.count = entry.requests.length;
    entry.resetTime = now + config.windowMs;
    
    rateLimitStore.set(key, entry);
    
    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetTime: entry.resetTime
    };
  }
}

/**
 * Rate limiting middleware factory
 */
export function createRateLimitMiddleware(operation: string, additionalKeyExtractor?: (req: FastifyRequest) => string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Clean up expired entries periodically
    if (Math.random() < 0.01) { // 1% chance to cleanup
      cleanupExpiredEntries();
    }
    
    const config = RATE_LIMIT_CONFIGS[operation];
    if (!config) {
      throw new Error(`No rate limit configuration found for operation: ${operation}`);
    }
    
    // Extract user ID from request (assuming it's in the user object from auth middleware)
    const userId = (request as any).user?.sub;
    if (!userId) {
      throw BadgeErrorFactory.validationError('User ID not found in request', 'userId');
    }
    
    // Create rate limit key
    const additionalKey = additionalKeyExtractor ? additionalKeyExtractor(request) : undefined;
    const rateLimitKey = createRateLimitKey(userId, operation, additionalKey);
    
    // Check rate limit
    const result = await isWithinRateLimit(rateLimitKey, config);
    
    // Add rate limit headers
    reply.header('X-RateLimit-Limit', config.maxRequests);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
    
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter || 60);
      
      throw BadgeErrorFactory.businessLogic('rate_limit', {
        operation,
        userId,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        retryAfter: result.retryAfter
      });
    }
  };
}

/**
 * Specific rate limit middlewares for badge operations
 */
export const rateLimiters = {
  badgeCreate: createRateLimitMiddleware('badge-create'),
  
  badgeAward: createRateLimitMiddleware('badge-award'),
  
  badgeRevoke: createRateLimitMiddleware('badge-revoke'),
  
  badgeBulk: createRateLimitMiddleware('badge-bulk', (req) => {
    // Additional key based on bulk operation size for more granular limiting
    const body = req.body as any;
    const operationSize = body?.awards?.length || 0;
    return operationSize > 50 ? 'large' : 'small';
  }),
  
  badgeRead: createRateLimitMiddleware('badge-read'),
  
  badgeLeaderboard: createRateLimitMiddleware('badge-leaderboard', (req) => {
    // Additional key based on college ID to prevent cross-college abuse
    const params = req.params as any;
    return params?.collegeId || 'default';
  })
};

/**
 * Rate limit configuration for different user roles
 */
export const ROLE_BASED_LIMITS: Record<string, Partial<Record<string, RateLimitConfig>>> = {
  'HEAD_ADMIN': {
    'badge-create': {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxRequests: 20, // Higher limit for head admins
    },
    'badge-award': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 50, // Higher limit for head admins
    }
  },
  
  'DEPT_ADMIN': {
    'badge-create': {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxRequests: 5, // Lower limit for dept admins
    },
    'badge-award': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 20, // Lower limit for dept admins
    }
  },
  
  'FACULTY': {
    'badge-award': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 15, // Limited for faculty
    },
    'badge-revoke': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 5, // Very limited revocation for faculty
    }
  }
};

/**
 * Enhanced rate limiter that considers user roles
 */
export function createRoleBasedRateLimitMiddleware(operation: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) {
      throw BadgeErrorFactory.validationError('User not found in request', 'user');
    }
    
    // Get user's highest role
    const userRoles = user.roles || [];
    let config = RATE_LIMIT_CONFIGS[operation];
    
    // Apply role-based limits (use the most permissive limit if user has multiple roles)
    for (const role of ['HEAD_ADMIN', 'DEPT_ADMIN', 'FACULTY']) {
      if (userRoles.includes(role) && ROLE_BASED_LIMITS[role]?.[operation]) {
        const roleConfig = ROLE_BASED_LIMITS[role][operation]!;
        if (roleConfig.maxRequests > config.maxRequests) {
          config = roleConfig;
        }
      }
    }
    
    const rateLimitKey = createRateLimitKey(user.sub, operation, user.roles.join(','));
    const result = await isWithinRateLimit(rateLimitKey, config);
    
    // Add rate limit headers
    reply.header('X-RateLimit-Limit', config.maxRequests);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
    reply.header('X-RateLimit-Policy', `${config.maxRequests};w=${config.windowMs / 1000}`);
    
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter || 60);
      
      throw BadgeErrorFactory.businessLogic('rate_limit', {
        operation,
        userId: user.sub,
        userRoles,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        retryAfter: result.retryAfter
      });
    }
  };
}

/**
 * Utility function to get current rate limit status for a user
 */
export async function getRateLimitStatus(userId: string, operation: string): Promise<{
  remaining: number;
  resetTime: number;
  limit: number;
}> {
  const config = RATE_LIMIT_CONFIGS[operation];
  if (!config) {
    throw new Error(`No rate limit configuration found for operation: ${operation}`);
  }
  
  const key = createRateLimitKey(userId, operation);
  const result = await isWithinRateLimit(key, config);
  
  return {
    remaining: result.remaining,
    resetTime: result.resetTime,
    limit: config.maxRequests
  };
}

/**
 * Reset rate limit for a user (admin function)
 */
export function resetRateLimit(userId: string, operation?: string): void {
  if (operation) {
    const key = createRateLimitKey(userId, operation);
    rateLimitStore.delete(key);
  } else {
    // Reset all rate limits for user
    for (const key of rateLimitStore.keys()) {
      if (key.includes(`rate_limit:${userId}:`)) {
        rateLimitStore.delete(key);
      }
    }
  }
}

// Export rate limit configurations for testing and monitoring
export { RATE_LIMIT_CONFIGS, rateLimitStore };
