import { FastifyRequest, FastifyReply } from "fastify";
import { RedisRateLimiter } from "../utils/redisClient.js";

/**
 * Rate limiting middleware using Redis-based sliding window
 * Critical for 10M+ user scalability
 */

interface RateLimitOptions {
  max: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: FastifyRequest) => string;
}

export function createRateLimit(options: RateLimitOptions) {
  const {
    max,
    windowMs,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req: FastifyRequest) => {
      // Use user ID if authenticated, otherwise IP
      const user = (req as any).user;
      return user?.sub || req.ip || 'anonymous';
    }
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = keyGenerator(request);
    const rateLimitKey = `rate_limit:${key}`;

    try {
      const result = await RedisRateLimiter.checkRateLimit(
        rateLimitKey,
        windowMs,
        max
      );

      // Add rate limit headers
      reply.header('X-RateLimit-Limit', max);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

      if (!result.allowed) {
        reply.header('Retry-After', result.retryAfter || Math.ceil(windowMs / 1000));
        return reply.code(429).send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${result.retryAfter || Math.ceil(windowMs / 1000)} seconds.`,
          retryAfter: result.retryAfter
        });
      }

      // Note: skipSuccessfulRequests/skipFailedRequests handling removed
      // This would require app-level hooks, not reply-level hooks

      // CRITICAL FIX: Return to allow request to continue
      return;

    } catch (error) {
      // If Redis fails, log error but don't block the request
      console.error('[RateLimit] Rate limiting check failed:', error);
      // In production, you might want to fail-open or use in-memory fallback
      return; // Allow request to continue even if rate limiting fails
    }
  };
}

// Pre-configured rate limiters for different endpoint types
export const generalRateLimit = createRateLimit({
  max: 1000, // 1000 requests per minute per user
  windowMs: 60 * 1000, // 1 minute
});

export const authRateLimit = createRateLimit({
  max: 100, // 100 auth requests per minute per IP
  windowMs: 60 * 1000,
  keyGenerator: (req) => req.ip || 'anonymous'
});

export const adminRateLimit = createRateLimit({
  max: 500, // 500 admin requests per minute per user
  windowMs: 60 * 1000,
});

export const badgeRateLimit = createRateLimit({
  max: 50, // 50 badge operations per minute per user
  windowMs: 60 * 1000,
});

export const uploadRateLimit = createRateLimit({
  max: 20, // 20 uploads per minute per user
  windowMs: 60 * 1000,
});
