import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from '../middleware/adminAuth';
import { AdminProfileService } from '../services/AdminProfileService';
import { AdminBadgeService } from '../services/AdminBadgeService';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService';
import { logAdminAction, logBadgeAction } from '../middleware/auditLogger';
import { 
  ProfileUpdateRequest, 
  BulkProfileOperation,
  BadgeDefinitionRequest,
  BadgeAwardRequest,
  BulkBadgeOperation,
  AdminResponse,
  ProfileFilters,
  BadgeFilters,
  PaginationParams
} from '../types/adminTypes';

export class HeadAdminController {
  /**
   * Get HEAD_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      const [
        profileAnalytics,
        badgeStatistics,
        completionStats
      ] = await Promise.all([
        AdminAnalyticsService.getProfileAnalytics(collegeId),
        AdminBadgeService.getBadgeStatistics(collegeId),
        AdminProfileService.getCompletionStats(collegeId)
      ]);

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          profileAnalytics,
          badgeStatistics,
          completionStats
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load dashboard'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get profiles with filtering
   */
  static async getProfiles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const filters: ProfileFilters = {
        departments: query.departments,
        years: query.years,
        skills: query.skills,
        badges: query.badges,
        completionStatus: query.completionStatus,
        hasProjects: query.hasProjects,
        hasPublications: query.hasPublications,
        search: query.search,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore
      };

      const pagination: PaginationParams = {
        page: query.page || 1,
        limit: query.limit || 50,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc'
      };

      const result = await AdminProfileService.getProfiles(
        filters, 
        pagination, 
        adminRequest.admin.collegeId
      );

      const response: AdminResponse = {
        success: true,
        data: result.profiles,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch profiles'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get single profile
   */
  static async getProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };

      const profile = await AdminProfileService.getProfileById(
        userId, 
        adminRequest.admin.collegeId
      );

      const response: AdminResponse = {
        success: true,
        data: profile
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Profile not found'
      };
      return reply.status(404).send(response);
    }
  }

  /**
   * Update profile
   */
  static async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as ProfileUpdateRequest;

      const profile = await AdminProfileService.updateProfile(
        userId,
        updateData,
        adminRequest.admin.collegeId,
        adminRequest.admin.id
      );

      await logAdminAction(
        request, 
        'UPDATE_PROFILE', 
        'PROFILE', 
        userId, 
        { updateData }
      );

      const response: AdminResponse = {
        success: true,
        data: profile,
        message: 'Profile updated successfully'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update profile'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Bulk profile operations
   */
  static async bulkProfileOperation(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const operation = request.body as BulkProfileOperation;

      const result = await AdminProfileService.bulkOperation(
        operation,
        adminRequest.admin.collegeId,
        adminRequest.admin.id
      );

      await logAdminAction(
        request, 
        'BULK_OPERATION', 
        'PROFILE', 
        undefined, 
        { 
          action: operation.action, 
          totalProfiles: operation.profiles.length,
          preview: operation.preview 
        }
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: operation.preview ? 'Bulk operation preview completed' : 'Bulk operation completed'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Bulk operation failed'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Create badge definition
   */
  static async createBadge(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const badgeData = request.body as BadgeDefinitionRequest;

      const badge = await AdminBadgeService.createBadgeDefinition(
        badgeData,
        adminRequest.admin.collegeId,
        adminRequest.admin.id
      );

      await logBadgeAction(
        request, 
        'CREATE_BADGE', 
        badge.id, 
        { badgeData }
      );

      const response: AdminResponse = {
        success: true,
        data: badge,
        message: 'Badge created successfully'
      };

      return reply.status(201).send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create badge'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Award badge to student
   */
  static async awardBadge(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const awardData = request.body as BadgeAwardRequest;

      const studentBadge = await AdminBadgeService.awardBadge(
        awardData,
        adminRequest.admin.id,
        adminRequest.admin.collegeId
      );

      await logBadgeAction(
        request, 
        'AWARD_BADGE', 
        awardData.badgeDefinitionId, 
        { 
          studentId: awardData.userId,
          reason: awardData.reason 
        }
      );

      const response: AdminResponse = {
        success: true,
        data: studentBadge,
        message: 'Badge awarded successfully'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to award badge'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Get badge leaderboard
   */
  static async getBadgeLeaderboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { limit } = request.query as { limit?: string };

      const leaderboard = await AdminBadgeService.getBadgeLeaderboard(
        adminRequest.admin.collegeId,
        limit ? parseInt(limit) : 50
      );

      const response: AdminResponse = {
        success: true,
        data: leaderboard
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch leaderboard'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get analytics
   */
  static async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { type } = request.query as { type?: string };
      const collegeId = adminRequest.admin.collegeId;

      let analyticsData;

      switch (type) {
        case 'skills':
          analyticsData = await AdminAnalyticsService.getSkillTrendAnalysis(collegeId);
          break;
        case 'placement':
          analyticsData = await AdminAnalyticsService.getPlacementReadinessReport(collegeId);
          break;
        default:
          analyticsData = await AdminAnalyticsService.getProfileAnalytics(collegeId);
      }

      const response: AdminResponse = {
        success: true,
        data: analyticsData
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch analytics'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Set profile requirements
   */
  static async setProfileRequirements(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const requirements = request.body as any;
      requirements.collegeId = adminRequest.admin.collegeId;

      const result = await AdminProfileService.setProfileRequirements(
        adminRequest.admin.collegeId,
        requirements
      );

      await logAdminAction(
        request, 
        'UPDATE_REQUIREMENTS', 
        'PROFILE_REQUIREMENTS', 
        adminRequest.admin.collegeId, 
        { requirements }
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: 'Profile requirements updated successfully'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update requirements'
      };
      return reply.status(400).send(response);
    }
  }
}
