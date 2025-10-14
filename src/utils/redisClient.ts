import Redis from 'ioredis';
import { env } from '../config/env.js';

/**
 * Redis client for caching and rate limiting
 * Provides connection management and error handling
 */

export class RedisClient {
  private static instance: Redis | null = null;
  private static isConnected = false;
  private static connectionAttempts = 0;
  private static readonly maxRetries = 3;

  /**
   * Get Redis client instance (singleton pattern)
   */
  static getInstance(): Redis | null {
    if (!this.instance && env.REDIS_URL && env.REDIS_ENABLED) {
      this.connect();
    }
    return this.instance;
  }

  /**
   * Connect to Redis with error handling and retries
   */
  private static connect(): void {
    try {
      if (this.connectionAttempts >= this.maxRetries) {
        console.error('[Redis] Max connection attempts reached, giving up');
        return;
      }

      this.connectionAttempts++;
      console.log(`[Redis] Connecting to Redis (attempt ${this.connectionAttempts}/${this.maxRetries})`);

      this.instance = new Redis(env.REDIS_URL, {
        connectTimeout: 5000,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        showFriendlyErrorStack: env.NODE_ENV === 'development',
      });

      // Handle database selection errors gracefully
      this.instance.on('error', (error) => {
        if (error.message && error.message.includes('DB index is out of range')) {
          console.warn('[Redis] Database index out of range, attempting fallback to database 0');
          this.attemptFallbackConnection();
        }
      });

      this.setupEventHandlers();
      
      // Attempt connection
      this.instance.connect().catch((error) => {
        console.error('[Redis] Connection failed:', error);
        this.handleConnectionError();
      });

    } catch (error) {
      console.error('[Redis] Failed to create Redis instance:', error);
      this.handleConnectionError();
    }
  }

  /**
   * Setup Redis event handlers
   */
  private static setupEventHandlers(): void {
    if (!this.instance) return;

    this.instance.on('connect', () => {
      console.log('[Redis] Connected to Redis server');
      this.isConnected = true;
      this.connectionAttempts = 0;
    });

    this.instance.on('ready', () => {
      console.log('[Redis] Redis client ready');
    });

    this.instance.on('error', (error) => {
      console.error('[Redis] Redis error:', error);
      this.isConnected = false;
      
      // Handle specific database index error
      if (error.message && error.message.includes('DB index is out of range')) {
        console.warn('[Redis] Database index out of range - Redis instance may not support multiple databases');
        console.warn('[Redis] Consider updating REDIS_URL to use database 0 or remove database specification');
      }
    });

    this.instance.on('close', () => {
      console.warn('[Redis] Redis connection closed');
      this.isConnected = false;
    });

    this.instance.on('reconnecting', () => {
      console.log('[Redis] Reconnecting to Redis...');
    });
  }

  /**
   * Attempt fallback connection to database 0 when database 1 is not available
   */
  private static attemptFallbackConnection(): void {
    try {
      console.log('[Redis] Attempting fallback connection to database 0');
      
      // Create fallback URL with database 0
      const fallbackUrl = env.REDIS_URL.replace(/\/\d+$/, '/0');
      
      // Disconnect current instance
      if (this.instance) {
        this.instance.disconnect();
      }
      
      // Create new instance with database 0
      this.instance = new Redis(fallbackUrl, {
        connectTimeout: 5000,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        showFriendlyErrorStack: env.NODE_ENV === 'development',
      });
      
      this.setupEventHandlers();
      
      // Attempt connection
      this.instance.connect().then(() => {
        console.log('[Redis] Successfully connected to fallback database 0');
        console.warn('[Redis] WARNING: Using shared database 0 - consider using key prefixes for data isolation');
      }).catch((error) => {
        console.error('[Redis] Fallback connection failed:', error);
        this.handleConnectionError();
      });
      
    } catch (error) {
      console.error('[Redis] Failed to create fallback connection:', error);
      this.handleConnectionError();
    }
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private static handleConnectionError(): void {
    this.isConnected = false;
    
    if (this.connectionAttempts < this.maxRetries) {
      const delay = Math.pow(2, this.connectionAttempts) * 1000; // Exponential backoff
      console.log(`[Redis] Retrying connection in ${delay}ms`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error('[Redis] All connection attempts failed, Redis features disabled');
      this.instance = null;
    }
  }

  /**
   * Check if Redis is connected and available
   */
  static isAvailable(): boolean {
    return this.isConnected && this.instance !== null;
  }

  /**
   * Gracefully disconnect from Redis
   */
  static async disconnect(): Promise<void> {
    if (this.instance) {
      console.log('[Redis] Disconnecting from Redis');
      await this.instance.quit();
      this.instance = null;
      this.isConnected = false;
    }
  }

  /**
   * Execute Redis command with error handling
   */
  static async safeExecute<T>(
    operation: (client: Redis) => Promise<T>,
    fallback?: T
  ): Promise<T | null> {
    const client = this.getInstance();
    
    if (!client || !this.isAvailable()) {
      console.warn('[Redis] Redis not available, using fallback');
      return fallback || null;
    }

    try {
      return await operation(client);
    } catch (error) {
      console.error('[Redis] Operation failed:', error);
      return fallback || null;
    }
  }
}

/**
 * Redis-based rate limiting implementation with service-specific key prefixing
 */
export class RedisRateLimiter {
  private static readonly SERVICE_PREFIX = 'profile-service:ratelimit:';

  /**
   * Add service prefix to rate limit key for data isolation
   */
  private static prefixKey(key: string): string {
    return `${this.SERVICE_PREFIX}${key}`;
  }
  /**
   * Check rate limit using sliding window algorithm
   */
  static async checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  }> {
    const prefixedKey = this.prefixKey(key);
    const client = RedisClient.getInstance();
    
    // Fallback to in-memory if Redis unavailable
    if (!client || !RedisClient.isAvailable()) {
      console.warn('[RateLimit] Redis unavailable, using in-memory fallback');
      return this.inMemoryFallback(key, windowMs, maxRequests);
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    const pipeline = client.pipeline();

    try {
      // Remove expired entries and count current requests
      pipeline.zremrangebyscore(prefixedKey, 0, windowStart);
      pipeline.zcard(prefixedKey);
      pipeline.zadd(prefixedKey, now, `${now}-${Math.random()}`);
      pipeline.expire(prefixedKey, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Pipeline execution failed');
      }

      const currentCount = (results[1][1] as number) || 0;
      const remaining = Math.max(0, maxRequests - currentCount - 1);
      const resetTime = now + windowMs;

      if (currentCount >= maxRequests) {
        // Get oldest request to calculate retry-after
        const oldestRequests = await client.zrange(prefixedKey, 0, 0, 'WITHSCORES');
        const oldestTime = oldestRequests.length > 0 ? parseInt(oldestRequests[1]) : now;
        const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          retryAfter: Math.max(1, retryAfter)
        };
      }

      return {
        allowed: true,
        remaining,
        resetTime
      };

    } catch (error) {
      console.error('[RateLimit] Redis rate limit check failed:', error);
      return this.inMemoryFallback(key, windowMs, maxRequests);
    }
  }

  /**
   * In-memory fallback for rate limiting when Redis is unavailable
   */
  private static inMemoryStore = new Map<string, { requests: number[]; resetTime: number }>();

  private static inMemoryFallback(
    key: string,
    windowMs: number,
    maxRequests: number
  ): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    let entry = this.inMemoryStore.get(key);
    if (!entry) {
      entry = { requests: [], resetTime: now + windowMs };
      this.inMemoryStore.set(key, entry);
    }

    // Remove expired requests
    entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);

    if (entry.requests.length >= maxRequests) {
      const oldestRequest = Math.min(...entry.requests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetTime: oldestRequest + windowMs,
        retryAfter: Math.max(1, retryAfter)
      };
    }

    entry.requests.push(now);
    entry.resetTime = now + windowMs;

    return {
      allowed: true,
      remaining: maxRequests - entry.requests.length,
      resetTime: entry.resetTime
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  static async resetRateLimit(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    return await RedisClient.safeExecute(async (client) => {
      await client.del(prefixedKey);
      return true;
    }, false) || false;
  }
}

/**
 * Redis-based caching utilities with service-specific key prefixing
 */
export class RedisCache {
  private static readonly SERVICE_PREFIX = 'profile-service:';

  /**
   * Add service prefix to key for data isolation
   */
  private static prefixKey(key: string): string {
    return `${this.SERVICE_PREFIX}${key}`;
  }
  /**
   * Set cache value with TTL
   */
  static async set(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    return await RedisClient.safeExecute(async (client) => {
      const serialized = JSON.stringify(value);
      await client.setex(prefixedKey, ttlSeconds, serialized);
      return true;
    }, false) || false;
  }

  /**
   * Get cache value
   */
  static async get<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    return await RedisClient.safeExecute(async (client) => {
      const value = await client.get(prefixedKey);
      return value ? JSON.parse(value) : null;
    }, null);
  }

  /**
   * Delete cache key
   */
  static async del(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    return await RedisClient.safeExecute(async (client) => {
      await client.del(prefixedKey);
      return true;
    }, false) || false;
  }

  /**
   * Check if key exists
   */
  static async exists(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    return await RedisClient.safeExecute(async (client) => {
      const result = await client.exists(prefixedKey);
      return result === 1;
    }, false) || false;
  }

  /**
   * Set cache with automatic key expiration
   */
  static async setWithAutoExpire(key: string, value: any, ttlSeconds: number = 300): Promise<boolean> {
    return this.set(key, value, ttlSeconds);
  }

  /**
   * Get or set pattern (cache-aside)
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<T | null> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    try {
      // Fetch fresh data
      const fresh = await fetcher();
      
      // Cache the result
      await this.set(key, fresh, ttlSeconds);
      
      return fresh;
    } catch (error) {
      console.error(`[Cache] Failed to fetch data for key ${key}:`, error);
      return null;
    }
  }
}

// Initialize Redis connection on module load
if (env.REDIS_ENABLED) {
  RedisClient.getInstance();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await RedisClient.disconnect();
});

process.on('SIGINT', async () => {
  await RedisClient.disconnect();
});
