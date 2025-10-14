import { env } from '../config/env.js';

export interface BadgeAwardData {
  id: string;
  studentId: string;
  badgeId: string;
  awardedBy: string;
  awardedByName?: string | null;
  reason: string;
  awardedAt: Date;
  projectId?: string | null;
  eventId?: string | null;
  badge: {
    id: string;
    name: string;
    description: string;
    rarity?: string | null;
  };
}

export interface AwarderInfo {
  id: string;
  displayName?: string;
  name?: string;
  token?: string;
}

export interface StudentInfo {
  id: string;
  displayName?: string;
  name?: string;
}

export class BadgePostService {
  private static readonly networkServiceUrl = env.NETWORK_SERVICE_URL;

  /**
   * Create a badge award post in the network service
   */
  static async createBadgeAwardPost(
    badge: BadgeAwardData,
    awardedBy: AwarderInfo,
    studentInfo: StudentInfo
  ): Promise<void> {
    // Check if auto-post is enabled
    const autoPostEnabled = env.BADGE_AUTO_POST_ENABLED;
    if (!autoPostEnabled) {
      console.log('[BadgePostService] Badge auto-post is disabled');
      return;
    }

    const studentName = studentInfo?.displayName || studentInfo?.name || 'Student';
    const facultyName = badge.awardedByName ?? awardedBy.displayName ?? awardedBy.name ?? 'Faculty';
    
    // Create content for badge award post
    const content = `🎉 Congratulations to ${studentName} for earning the "${badge.badge.name}" badge!\n\n${badge.reason || 'Great achievement!'}`;
    
    const postData = {
      type: 'BADGE_AWARD',
      content,
      visibility: 'COLLEGE',
      badgeData: {
        badgeId: badge.badge.id,
        badgeName: badge.badge.name,
        description: badge.badge.description,
        rarity: badge.badge.rarity?.toLowerCase() || 'common',
        awardedTo: studentName,
        awardedToId: badge.studentId,
        awardedAt: badge.awardedAt,
        awardedBy: facultyName,
        awardedById: badge.awardedBy,
        projectId: badge.projectId,
        eventId: badge.eventId,
        reason: badge.reason
      },
      tags: ['badge', 'achievement']
    };

    try {
      console.log('[BadgePostService] Creating badge award post:', {
        badgeName: badge.badge.name,
        studentName,
        facultyName
      });

      const response = await fetch(`${this.networkServiceUrl}/v1/posts/specialized`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${awardedBy.token || ''}`
        },
        body: JSON.stringify(postData)
      });

      if (!response.ok) {
        throw new Error(`Network service returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[BadgePostService] Badge award post created successfully:', result.id);
    } catch (error) {
      console.error('[BadgePostService] Failed to create badge award post:', error);
      // Don't throw error - badge awarding should succeed even if post creation fails
    }
  }

  /**
   * Create badge award post with minimal data (for backward compatibility)
   */
  static async createSimpleBadgePost(
    badgeAward: any,
    awardedByToken: string
  ): Promise<void> {
    const badge: BadgeAwardData = {
      id: badgeAward.id,
      studentId: badgeAward.studentId,
      badgeId: badgeAward.badgeId,
      awardedBy: badgeAward.awardedBy,
      awardedByName: badgeAward.awardedByName,
      reason: badgeAward.reason,
      awardedAt: badgeAward.awardedAt,
      projectId: badgeAward.projectId,
      eventId: badgeAward.eventId,
      badge: badgeAward.badge
    };

    const awardedBy: AwarderInfo = {
      id: badgeAward.awardedBy,
      displayName: badgeAward.awardedByName,
      token: awardedByToken
    };

    const studentInfo: StudentInfo = {
      id: badgeAward.studentId,
      displayName: 'Student' // Will be enhanced with actual student data in the future
    };

    await this.createBadgeAwardPost(badge, awardedBy, studentInfo);
  }
}
