/**
 * Performance monitoring utilities for production optimization
 * Addresses N+1 queries and database performance issues
 */

interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: Date;
  count: number;
}

interface PerformanceMetrics {
  totalQueries: number;
  averageQueryTime: number;
  slowQueries: QueryMetrics[];
  nPlusOneDetected: boolean;
  memoryUsage: NodeJS.MemoryUsage;
}

export class PerformanceMonitor {
  private static queries: QueryMetrics[] = [];
  private static slowQueryThreshold = 100; // 100ms
  private static maxStoredQueries = 1000;
  private static nPlusOneThreshold = 10; // Detect if same query runs >10 times

  /**
   * Track database query performance
   */
  static trackQuery(query: string, duration: number): void {
    const metric: QueryMetrics = {
      query: this.normalizeQuery(query),
      duration,
      timestamp: new Date(),
      count: 1
    };

    // Check if this query pattern already exists
    const existingIndex = this.queries.findIndex(q => q.query === metric.query);
    if (existingIndex >= 0) {
      this.queries[existingIndex].count++;
      this.queries[existingIndex].duration = 
        (this.queries[existingIndex].duration + duration) / 2; // Average
    } else {
      this.queries.push(metric);
    }

    // Keep only recent queries
    if (this.queries.length > this.maxStoredQueries) {
      this.queries = this.queries.slice(-this.maxStoredQueries);
    }

    // Log slow queries immediately
    if (duration > this.slowQueryThreshold) {
      console.warn('[Performance] Slow query detected:', {
        query: metric.query,
        duration: `${duration}ms`,
        timestamp: metric.timestamp
      });
    }

    // Detect potential N+1 queries
    if (this.queries[existingIndex]?.count > this.nPlusOneThreshold) {
      console.error('[Performance] Potential N+1 query detected:', {
        query: metric.query,
        count: this.queries[existingIndex].count,
        averageDuration: `${this.queries[existingIndex].duration}ms`
      });
    }
  }

  /**
   * Normalize query for pattern detection
   */
  private static normalizeQuery(query: string): string {
    return query
      .replace(/\$\d+/g, '$?') // Replace parameter placeholders
      .replace(/\d+/g, '?') // Replace numbers with placeholders
      .replace(/['"][^'"]*['"]/g, '?') // Replace string literals
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Get current performance metrics
   */
  static getMetrics(): PerformanceMetrics {
    const now = Date.now();
    const recentQueries = this.queries.filter(q => 
      now - q.timestamp.getTime() < 60000 // Last minute
    );

    const totalDuration = recentQueries.reduce((sum, q) => sum + q.duration, 0);
    const slowQueries = recentQueries.filter(q => q.duration > this.slowQueryThreshold);
    const nPlusOneDetected = recentQueries.some(q => q.count > this.nPlusOneThreshold);

    return {
      totalQueries: recentQueries.length,
      averageQueryTime: recentQueries.length > 0 ? totalDuration / recentQueries.length : 0,
      slowQueries: slowQueries.slice(0, 10), // Top 10 slow queries
      nPlusOneDetected,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  static reset(): void {
    this.queries = [];
  }

  /**
   * Set configuration
   */
  static configure(options: {
    slowQueryThreshold?: number;
    maxStoredQueries?: number;
    nPlusOneThreshold?: number;
  }): void {
    if (options.slowQueryThreshold !== undefined) {
      this.slowQueryThreshold = options.slowQueryThreshold;
    }
    if (options.maxStoredQueries !== undefined) {
      this.maxStoredQueries = options.maxStoredQueries;
    }
    if (options.nPlusOneThreshold !== undefined) {
      this.nPlusOneThreshold = options.nPlusOneThreshold;
    }
  }
}

/**
 * Decorator for timing async functions
 */
export function timed(target: any, propertyName: string, descriptor: PropertyDescriptor) {
  const method = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const start = Date.now();
    try {
      const result = await method.apply(this, args);
      const duration = Date.now() - start;
      
      console.debug(`[Performance] ${target.constructor.name}.${propertyName} took ${duration}ms`);
      
      if (duration > 1000) { // Log functions taking >1 second
        console.warn(`[Performance] Slow function detected: ${target.constructor.name}.${propertyName} took ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`[Performance] ${target.constructor.name}.${propertyName} failed after ${duration}ms:`, error);
      throw error;
    }
  };
}

/**
 * Optimized database query helpers to prevent N+1 queries
 */
export class OptimizedQueries {
  /**
   * Batch load users with their profiles and badges
   * Prevents N+1 queries when loading multiple users
   */
  static async batchLoadUsersWithProfiles(userIds: string[], prisma: any) {
    if (userIds.length === 0) return [];

    const start = Date.now();
    
    try {
      // Single query to load all users with their data
      const profiles = await prisma.profile.findMany({
        where: {
          userId: { in: userIds }
        },
        select: {
          id: true,
          userId: true,
          name: true,
          bio: true,
          skills: true,
          expertise: true,
          avatar: true,
          studentBadges: {
            select: {
              id: true,
              awardedAt: true,
              badge: {
                select: {
                  id: true,
                  name: true,
                  icon: true,
                  color: true,
                  category: true,
                  rarity: true
                }
              }
            },
            orderBy: { awardedAt: 'desc' },
            take: 5 // Limit badges per user
          }
        }
      });

      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('batchLoadUsersWithProfiles', duration);

      return profiles;
    } catch (error) {
      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('batchLoadUsersWithProfiles_ERROR', duration);
      throw error;
    }
  }

  /**
   * Optimized badge statistics query
   * Aggregates badge data efficiently
   */
  static async getBadgeStatistics(collegeId?: string, prisma?: any) {
    const start = Date.now();
    
    try {
      const whereClause = collegeId ? {
        badge: { collegeId }
      } : {};

      // Use aggregation instead of loading all records
      const stats = await prisma.studentBadge.groupBy({
        by: ['badgeId'],
        where: whereClause,
        _count: {
          studentId: true
        },
        _min: {
          awardedAt: true
        },
        _max: {
          awardedAt: true
        }
      });

      // Get badge details in a separate optimized query
      const badgeIds = stats.map((s: any) => s.badgeId);
      const badges = await prisma.badgeDefinition.findMany({
        where: {
          id: { in: badgeIds }
        },
        select: {
          id: true,
          name: true,
          category: true,
          rarity: true,
          points: true
        }
      });

      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('getBadgeStatistics', duration);

      // Combine the data
      return stats.map((stat: any) => {
        const badge = badges.find((b: any) => b.id === stat.badgeId);
        return {
          ...stat,
          badge
        };
      });
    } catch (error) {
      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('getBadgeStatistics_ERROR', duration);
      throw error;
    }
  }

  /**
   * Optimized user directory query with pagination
   * Includes proper indexing hints and field selection
   */
  static async getUserDirectory(
    options: {
      search?: string;
      skills?: string[];
      department?: string;
      collegeId?: string;
      limit?: number;
      offset?: number;
    },
    prisma: any
  ) {
    const start = Date.now();
    const { search, skills, department, collegeId, limit = 20, offset = 0 } = options;

    try {
      const whereClause: any = {};

      // Build efficient where clause
      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { bio: { contains: search, mode: 'insensitive' } }
        ];
      }

      if (skills && skills.length > 0) {
        whereClause.skills = {
          hasSome: skills
        };
      }

      // Use select to limit fields and prevent over-fetching
      const users = await prisma.profile.findMany({
        where: whereClause,
        select: {
          id: true,
          userId: true,
          name: true,
          bio: true,
          skills: true,
          avatar: true,
          // Only load essential badge data
          studentBadges: {
            select: {
              badge: {
                select: {
                  name: true,
                  icon: true,
                  color: true,
                  rarity: true
                }
              }
            },
            take: 3, // Limit to top 3 badges
            orderBy: { awardedAt: 'desc' }
          }
        },
        orderBy: [
          { name: 'asc' }
        ],
        take: limit,
        skip: offset
      });

      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('getUserDirectory', duration);

      return users;
    } catch (error) {
      const duration = Date.now() - start;
      PerformanceMonitor.trackQuery('getUserDirectory_ERROR', duration);
      throw error;
    }
  }
}
