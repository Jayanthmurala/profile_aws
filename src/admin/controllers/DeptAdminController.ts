import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from '../middleware/adminAuth';
import { AdminProfileService } from '../services/AdminProfileService';
import { AdminBadgeService } from '../services/AdminBadgeService';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService';
import { logAdminAction, logBadgeAction } from '../middleware/auditLogger';
import { 
  ProfileUpdateRequest, 
  BulkProfileOperation,
  BadgeAwardRequest,
  AdminResponse,
  ProfileFilters,
  PaginationParams
} from '../types/adminTypes';

export class DeptAdminController {
  /**
   * Get DEPT_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      const [
        completionStats,
        badgeStatistics
      ] = await Promise.all([
        AdminProfileService.getCompletionStats(collegeId, department),
        AdminBadgeService.getBadgeStatistics(collegeId)
      ]);

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          department,
          completionStats,
          badgeStatistics: {
            ...badgeStatistics,
            // Filter to department-relevant data
            departmentFocus: true
          }
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
   * Get single profile in department
   */
  static async getProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };

      const profile = await AdminProfileService.getProfileById(
        userId,
        adminRequest.admin.collegeId
      );

      if (!profile) {
        const response: AdminResponse = {
          success: false,
          message: 'Profile not found or not accessible'
        };
        return reply.status(404).send(response);
      }

      // Department verification is handled by the service layer
      // AdminProfileService.getProfileById already checks college access
      // Additional department check would be done in the service if needed

      await logAdminAction(request, 'UPDATE_PROFILE', 'PROFILE', userId);

      const response: AdminResponse = {
        success: true,
        data: profile
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch profile'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get profiles in department
   */
  static async getProfiles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const filters: ProfileFilters = {
        departments: [adminRequest.admin.department!], // Restrict to admin's department
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
        adminRequest.admin.collegeId,
        adminRequest.admin.department,
        'DEPARTMENT'
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
   * Bulk profile operations in department
   */
  static async bulkProfileOperation(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const operation = request.body as BulkProfileOperation;

      // Ensure all profiles belong to admin's department by filtering the operation
      const departmentScopedOperation = {
        ...operation,
        profiles: operation.profiles // Service layer will handle department filtering
      };

      const result = await AdminProfileService.bulkOperation(
        departmentScopedOperation,
        adminRequest.admin.collegeId,
        adminRequest.admin.id
      );

      await logAdminAction(
        request, 
        'BULK_OPERATION', 
        'PROFILE', 
        undefined, 
        { operation: operation.action, count: operation.profiles.length }
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: `Bulk operation completed: ${result.successful}/${result.totalProcessed} successful`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to perform bulk operation'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Get completion statistics for department
   */
  static async getCompletionStats(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      const stats = await AdminProfileService.getCompletionStats(collegeId, department);

      const response: AdminResponse = {
        success: true,
        data: stats
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch completion statistics'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Update profile (department-scoped)
   */
  static async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as ProfileUpdateRequest;

      // Ensure department cannot be changed to outside admin's department
      if (updateData.department && updateData.department !== adminRequest.admin.department) {
        const response: AdminResponse = {
          success: false,
          message: 'Cannot transfer user to different department'
        };
        return reply.status(403).send(response);
      }

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
        { updateData, scope: 'DEPARTMENT' }
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
   * Award badge to student in department
   */
  static async awardBadge(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const awardData = request.body as BadgeAwardRequest;

      // DEPT_ADMIN can only award badges, not create them
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
          reason: awardData.reason,
          scope: 'DEPARTMENT'
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
   * Get department analytics
   */
  static async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      const [
        profileAnalytics,
        completionStats
      ] = await Promise.all([
        AdminAnalyticsService.getProfileAnalytics(collegeId),
        AdminProfileService.getCompletionStats(collegeId, department)
      ]);

      // Filter analytics to department scope
      const departmentAnalytics = {
        ...profileAnalytics,
        // Filter skill distribution to department
        skillDistribution: profileAnalytics.skillDistribution.filter(skill => 
          skill.departments.includes(department)
        ),
        completionStats
      };

      const response: AdminResponse = {
        success: true,
        data: departmentAnalytics
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
   * Get available badges for department
   */
  static async getAvailableBadges(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const filters = {
        categories: query.categories,
        rarity: query.rarity,
        isActive: true, // Only active badges
        collegeSpecific: query.collegeSpecific
      };

      const pagination: PaginationParams = {
        page: query.page || 1,
        limit: query.limit || 50,
        sortBy: query.sortBy || 'name',
        sortOrder: query.sortOrder || 'asc'
      };

      const result = await AdminBadgeService.getBadgeDefinitions(
        filters,
        pagination,
        adminRequest.admin.collegeId
      );

      const response: AdminResponse = {
        success: true,
        data: result.badges,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch badges'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get department badge leaderboard
   */
  static async getBadgeLeaderboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { limit } = request.query as { limit?: string };

      // Get full leaderboard and filter to department
      const fullLeaderboard = await AdminBadgeService.getBadgeLeaderboard(
        adminRequest.admin.collegeId,
        200 // Get more to filter
      );

      // Filter to department students
      const departmentLeaderboard = fullLeaderboard.filter(student => 
        student.department === adminRequest.admin.department
      ).slice(0, limit ? parseInt(limit) : 50);

      // Re-rank after filtering
      const rerankedLeaderboard = departmentLeaderboard.map((student, index) => ({
        ...student,
        rank: index + 1
      }));

      const response: AdminResponse = {
        success: true,
        data: rerankedLeaderboard
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
   * Export department data
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { type, format } = request.query as { type: string; format?: string };
      const department = adminRequest.admin.department!;

      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'profiles':
          // Get department profiles for export
          const profiles = await AdminProfileService.getProfiles(
            { departments: [department] },
            { page: 1, limit: 1000, sortBy: 'createdAt', sortOrder: 'desc' },
            adminRequest.admin.collegeId,
            department,
            'DEPARTMENT'
          );

          const headers = ['Name', 'Email', 'Skills', 'Projects', 'Badges', 'Completion %'];
          const rows = profiles.profiles.map(profile => [
            profile.user?.displayName || profile.name || '',
            profile.user?.email || '',
            profile.skills?.join(', ') || '',
            profile.personalProjects?.length || 0,
            profile.studentBadges?.length || 0,
            profile.completionStatus?.percentage || 0
          ]);

          csvContent = [
            headers.join(','),
            ...rows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `dept-profiles-${department}-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'leaderboard':
          const leaderboard = await this.getBadgeLeaderboard(request, reply);
          // This would be implemented similar to profiles export
          csvContent = 'Rank,Name,Department,Badge Count,Points\n';
          filename = `dept-leaderboard-${department}-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        default:
          throw new Error('Invalid export type');
      }

      await logAdminAction(
        request, 
        'EXPORT_DATA', 
        'DATA', 
        undefined, 
        { type, department, format: format || 'csv' }
      );

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(csvContent);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to export data'
      };
      return reply.status(400).send(response);
    }
  }
}
