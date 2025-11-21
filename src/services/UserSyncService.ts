/**
 * PHASE 3: User Sync Service
 * Listens for user updates from auth-service via Redis pub/sub
 * Invalidates profile cache when user data changes
 * Prevents stale data issues (24+ hour JWT expiry delay)
 */

import { RedisClient } from '../utils/redisClient.js';
import { prisma } from '../db.js';

export interface UserUpdateEvent {
  userId: string;
  changes: {
    displayName?: string;
    department?: string;
    year?: number;
    email?: string;
    collegeId?: string;
    roles?: string[];
  };
  timestamp: string;
}

export class UserSyncService {
  private static redis: any = RedisClient.getInstance();
  private static readonly CHANNEL = 'auth:user:updated';
  private static subscriber: any = null;

  /**
   * Start listening for user update events from auth-service
   * Called on service startup
   */
  static async startListening(): Promise<void> {
    try {
      if (!this.redis) {
        throw new Error('Redis client not available');
      }

      this.subscriber = this.redis.duplicate();
      
      if (!this.subscriber) {
        throw new Error('Failed to create Redis subscriber');
      }

      this.subscriber.on('message', async (channel: string, message: string) => {
        if (channel === this.CHANNEL) {
          try {
            const event: UserUpdateEvent = JSON.parse(message);
            await this.handleUserUpdate(event);
          } catch (error) {
            console.error('[UserSyncService] Failed to parse event:', error);
          }
        }
      });

      this.subscriber.on('error', (error: Error) => {
        console.error('[UserSyncService] Redis subscriber error:', error);
      });

      await this.subscriber.subscribe(this.CHANNEL);
      console.log('[UserSyncService] Started listening for user updates on channel:', this.CHANNEL);
    } catch (error) {
      console.error('[UserSyncService] Failed to start listening:', error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   * Called on service shutdown
   */
  static async stopListening(): Promise<void> {
    try {
      if (this.subscriber !== null) {
        await this.subscriber.unsubscribe(this.CHANNEL);
        await this.subscriber.quit();
        this.subscriber = null;
        console.log('[UserSyncService] Stopped listening for user updates');
      }
    } catch (error) {
      console.error('[UserSyncService] Failed to stop listening:', error);
    }
  }

  /**
   * Handle user update event
   * Invalidates cache and updates local data if needed
   */
  private static async handleUserUpdate(event: UserUpdateEvent): Promise<void> {
    const startTime = Date.now();
    const { userId, changes } = event;

    try {
      if (!this.redis) {
        console.warn('[UserSyncService] Redis client not available, skipping cache invalidation');
        return;
      }

      // PHASE 3: Invalidate all caches related to this user
      const cacheKeys = [
        `profile:${userId}`,
        `auth:user:${userId}`,
        'search:*',
        'directory:*'
      ];

      for (const key of cacheKeys) {
        if (key.includes('*')) {
          // Pattern delete for wildcard keys
          const matchedKeys = await this.redis.keys(key);
          if (matchedKeys && matchedKeys.length > 0) {
            await this.redis.del(...matchedKeys);
            console.log(`[UserSyncService] Invalidated ${matchedKeys.length} cache keys matching ${key}`);
          }
        } else {
          // Direct delete for specific keys
          await this.redis.del(key);
        }
      }

      // Log the sync event
      const duration = Date.now() - startTime;
      console.log(`[UserSyncService] Synced user ${userId} in ${duration}ms`, {
        changes: Object.keys(changes),
        timestamp: event.timestamp
      });

      // OPTIONAL: Update profile if needed (e.g., if displayName changed)
      if (changes.displayName) {
        await this.updateProfileIfNeeded(userId, changes);
      }
    } catch (error) {
      console.error('[UserSyncService] Failed to handle user update:', error);
    }
  }

  /**
   * Update profile data if needed
   * Called when user data changes in auth-service
   */
  private static async updateProfileIfNeeded(
    userId: string,
    changes: UserUpdateEvent['changes']
  ): Promise<void> {
    try {
      const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { id: true, name: true }
      });

      if (!profile) {
        console.log(`[UserSyncService] Profile not found for user ${userId}, skipping update`);
        return;
      }

      // Update profile name if displayName changed and profile name is empty
      if (changes.displayName && !profile.name) {
        await prisma.profile.update({
          where: { userId },
          data: { name: changes.displayName }
        });
        console.log(`[UserSyncService] Updated profile name for user ${userId}`);
      }
    } catch (error) {
      console.error('[UserSyncService] Failed to update profile:', error);
    }
  }

  /**
   * Publish user update event (called by auth-service)
   * Used for inter-service communication
   */
  static async publishUserUpdate(
    userId: string,
    changes: UserUpdateEvent['changes']
  ): Promise<void> {
    try {
      if (!this.redis) {
        console.warn('[UserSyncService] Redis client not available, skipping event publish');
        return;
      }

      const event: UserUpdateEvent = {
        userId,
        changes,
        timestamp: new Date().toISOString()
      };

      await this.redis.publish(this.CHANNEL, JSON.stringify(event));
      console.log('[UserSyncService] Published user update event:', userId);
    } catch (error) {
      console.error('[UserSyncService] Failed to publish user update:', error);
    }
  }

  /**
   * Get sync statistics
   */
  static async getStats(): Promise<{
    isListening: boolean;
    channel: string;
    timestamp: string;
  }> {
    return {
      isListening: this.subscriber !== null,
      channel: this.CHANNEL,
      timestamp: new Date().toISOString()
    };
  }
}
