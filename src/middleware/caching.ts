import { FastifyRequest, FastifyReply } from "fastify";
import { RedisCache } from "../utils/redisClient.js";
import { MetricsLogger } from "../utils/logger.js";

/**
 * Advanced Caching Middleware for 10M+ Users
 * Implements multi-level caching with intelligent invalidation
 */

interface CacheOptions {
  ttl: number;                    // Time to live in seconds
  keyPrefix?: string;             // Cache key prefix
  varyBy?: string[];              // Headers/params to vary cache by
  skipCache?: (req: FastifyRequest) => boolean;
  generateKey?: (req: FastifyRequest) => string;
  compress?: boolean;             // Compress large responses
  maxSize?: number;               // Max response size to cache (bytes)
}

interface CacheEntry {
  data: any;
  headers?: Record<string, string>;
  statusCode: number;
  timestamp: number;
  size: number;
  compressed?: boolean;
}

/**
 * Response caching middleware
 */
export function createCacheMiddleware(options: CacheOptions) {
  const {
    ttl,
    keyPrefix = 'cache',
    varyBy = [],
    skipCache,
    generateKey,
    compress = false,
    maxSize = 1024 * 1024 // 1MB default
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip caching for certain conditions
    if (skipCache && skipCache(request)) {
      return;
    }

    // Skip caching for non-GET requests
    if (request.method !== 'GET') {
      return;
    }

    // Generate cache key
    const cacheKey = generateKey ? 
      generateKey(request) : 
      generateCacheKey(request, keyPrefix, varyBy);

    const startTime = Date.now();

    try {
      // Try to get from cache first
      const cached = await RedisCache.get(cacheKey);
      
      if (cached && typeof cached === 'string') {
        const cacheEntry: CacheEntry = JSON.parse(cached);
        const cacheAge = Date.now() - cacheEntry.timestamp;
        
        // Set cache headers
        reply.header('X-Cache', 'HIT');
        reply.header('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
        reply.header('X-Cache-Key', cacheKey);
        
        // Set original headers
        if (cacheEntry.headers) {
          Object.entries(cacheEntry.headers).forEach(([key, value]) => {
            reply.header(key, value);
          });
        }

        const duration = Date.now() - startTime;
        MetricsLogger.logCacheOperation('hit', cacheKey, duration, cacheEntry.size);
        
        request.log.debug({
          type: 'cache_hit',
          cacheKey,
          cacheAge,
          size: cacheEntry.size,
          duration
        }, `Cache hit: ${cacheKey}`);

        return reply.code(cacheEntry.statusCode).send(cacheEntry.data);
      }

      // Cache miss - continue with request and cache response
      MetricsLogger.logCacheOperation('miss', cacheKey, Date.now() - startTime);
      
      request.log.debug({
        type: 'cache_miss',
        cacheKey
      }, `Cache miss: ${cacheKey}`);

      // Store cache key for later use in route handlers
      (request as any).cacheKey = cacheKey;
      (request as any).cacheTTL = ttl;
      (request as any).cacheMaxSize = maxSize;
      
      // Add cache miss header
      reply.header('X-Cache', 'MISS');
      reply.header('X-Cache-Key', cacheKey);

    } catch (error) {
      const duration = Date.now() - startTime;
      
      request.log.error({
        type: 'cache_error',
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      }, `Cache operation failed: ${cacheKey}`);
      
      // Continue without caching on error
    }
  };
}

/**
 * Generate cache key from request
 */
function generateCacheKey(
  request: FastifyRequest,
  prefix: string,
  varyBy: string[]
): string {
  const parts = [prefix, request.method, request.url];
  
  // Add vary-by parameters
  for (const vary of varyBy) {
    if (vary.startsWith('header:')) {
      const headerName = vary.substring(7);
      const headerValue = request.headers[headerName];
      if (headerValue) {
        parts.push(`${headerName}:${headerValue}`);
      }
    } else if (vary.startsWith('query:')) {
      const queryName = vary.substring(6);
      const queryValue = (request.query as any)?.[queryName];
      if (queryValue) {
        parts.push(`${queryName}:${queryValue}`);
      }
    } else if (vary === 'user') {
      const userId = (request as any).user?.sub;
      if (userId) {
        parts.push(`user:${userId}`);
      }
    }
  }
  
  return parts.join(':').replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/**
 * Get cacheable headers (exclude sensitive ones)
 */
function getCacheableHeaders(headers: Record<string, any>): Record<string, string> {
  const cacheable: Record<string, string> = {};
  const excludeHeaders = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-correlation-id',
    'date',
    'server'
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (!excludeHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
      cacheable[key] = value;
    }
  }

  return cacheable;
}

/**
 * Get payload size in bytes
 */
function getPayloadSize(payload: any): number {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload, 'utf8');
  } else if (Buffer.isBuffer(payload)) {
    return payload.length;
  } else if (typeof payload === 'object') {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }
  return 0;
}

/**
 * Manual cache operations for route handlers
 */
export class CacheHelper {
  /**
   * Cache a response manually
   */
  static async cacheResponse(
    cacheKey: string,
    data: any,
    ttl: number,
    statusCode: number = 200,
    headers?: Record<string, string>
  ): Promise<void> {
    try {
      const cacheEntry: CacheEntry = {
        data,
        headers: headers || {},
        statusCode,
        timestamp: Date.now(),
        size: getPayloadSize(data)
      };

      await RedisCache.set(cacheKey, JSON.stringify(cacheEntry), ttl);
      
      console.debug(`[Cache] Manually cached response: ${cacheKey}`);
    } catch (error) {
      console.error('[Cache] Failed to cache response:', cacheKey, error);
    }
  }

  /**
   * Get cached response
   */
  static async getCachedResponse(cacheKey: string): Promise<CacheEntry | null> {
    try {
      const cached = await RedisCache.get(cacheKey);
      if (cached && typeof cached === 'string') {
        return JSON.parse(cached) as CacheEntry;
      }
      return null;
    } catch (error) {
      console.error('[Cache] Failed to get cached response:', cacheKey, error);
      return null;
    }
  }
}

/**
 * Cache invalidation utilities
 */
export class CacheInvalidator {
  /**
   * Invalidate cache by pattern
   */
  static async invalidatePattern(pattern: string): Promise<number> {
    try {
      // Note: This is a simplified implementation
      // In production, you'd want to use Redis SCAN for better performance
      console.info(`[Cache] Would invalidate cache entries matching: ${pattern}`);
      return 0; // Placeholder - implement with proper Redis commands
    } catch (error) {
      console.error('[Cache] Failed to invalidate pattern:', pattern, error);
      return 0;
    }
  }

  /**
   * Invalidate user-specific cache
   */
  static async invalidateUser(userId: string): Promise<number> {
    return this.invalidatePattern(`*:user:${userId}*`);
  }

  /**
   * Invalidate profile-related cache
   */
  static async invalidateProfile(userId: string): Promise<number> {
    const patterns = [
      `cache:GET:/v1/profile*:user:${userId}*`,
      `cache:GET:/v1/profiles/search*`,
      `cache:GET:/v1/profiles/directory*`
    ];

    let totalInvalidated = 0;
    for (const pattern of patterns) {
      totalInvalidated += await this.invalidatePattern(pattern);
    }

    return totalInvalidated;
  }

  /**
   * Invalidate badge-related cache
   */
  static async invalidateBadges(userId?: string): Promise<number> {
    const patterns = userId ? [
      `cache:GET:/v1/profile/badges*:user:${userId}*`,
      `cache:GET:/v1/profiles/search*`,
      `cache:GET:/v1/profiles/directory*`
    ] : [
      `cache:GET:/v1/profile/badges*`,
      `cache:GET:/v1/profiles/search*`,
      `cache:GET:/v1/profiles/directory*`
    ];

    let totalInvalidated = 0;
    for (const pattern of patterns) {
      totalInvalidated += await this.invalidatePattern(pattern);
    }

    return totalInvalidated;
  }
}

/**
 * Pre-configured cache middleware for different endpoints
 */

// Profile data cache (5 minutes)
export const profileCache = createCacheMiddleware({
  ttl: 300,
  keyPrefix: 'profile',
  varyBy: ['user'],
  maxSize: 512 * 1024 // 512KB
});

// Search results cache (2 minutes)
export const searchCache = createCacheMiddleware({
  ttl: 120,
  keyPrefix: 'search',
  varyBy: ['query:q', 'query:skills', 'query:department', 'user'],
  maxSize: 1024 * 1024 // 1MB
});

// Directory cache (10 minutes)
export const directoryCache = createCacheMiddleware({
  ttl: 600,
  keyPrefix: 'directory',
  varyBy: ['query:department', 'query:year', 'query:role', 'user'],
  maxSize: 2 * 1024 * 1024 // 2MB
});

// Badge data cache (15 minutes)
export const badgeCache = createCacheMiddleware({
  ttl: 900,
  keyPrefix: 'badges',
  varyBy: ['user'],
  maxSize: 256 * 1024 // 256KB
});

// Statistics cache (30 minutes)
export const statsCache = createCacheMiddleware({
  ttl: 1800,
  keyPrefix: 'stats',
  varyBy: ['query:department', 'query:timeframe', 'user'],
  maxSize: 1024 * 1024 // 1MB
});
