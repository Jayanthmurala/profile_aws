import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from '../middleware/adminAuth';
import { AdminProfileService } from '../services/AdminProfileService';
import { AdminBadgeService } from '../services/AdminBadgeService';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService';
import { logAdminAction, logBadgeAction } from '../middleware/auditLogger';
import { 
  ProfileUpdateRequest, 
  BadgeAwardRequest,
  AdminResponse,
  ProfileFilters,
  PaginationParams
} from '../types/adminTypes';

export class PlacementsAdminController {
  /**
   * Get PLACEMENTS_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      const [
        placementReadiness,
        skillTrends,
        badgeStatistics
      ] = await Promise.all([
        AdminAnalyticsService.getPlacementReadinessReport(collegeId),
        AdminAnalyticsService.getSkillTrendAnalysis(collegeId),
        AdminBadgeService.getBadgeStatistics(collegeId)
      ]);

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          placementReadiness,
          skillTrends,
          badgeStatistics: {
            ...badgeStatistics,
            placementFocus: true
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
   * Get students with placement focus
   */
  static async getStudents(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const filters: ProfileFilters = {
        departments: query.departments,
        years: query.years,
        skills: query.skills,
        badges: query.badges,
        completionStatus: query.completionStatus,
        hasProjects: true, // Focus on students with projects
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
        undefined,
        'PLACEMENT'
      );

      // Enhance with placement readiness scores
      const enhancedProfiles = result.profiles.map(profile => ({
        ...profile,
        placementScore: this.calculatePlacementScore(profile),
        placementRecommendations: this.getPlacementRecommendations(profile)
      }));

      const response: AdminResponse = {
        success: true,
        data: enhancedProfiles,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch students'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get students by placement readiness
   */
  static async getStudentsByReadiness(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { readiness, department } = request.query as { readiness?: string; department?: string };

      const placementReport = await AdminAnalyticsService.getPlacementReadinessReport(
        adminRequest.admin.collegeId
      );

      let filteredStudents = placementReport.students;

      // Filter by readiness level
      if (readiness) {
        switch (readiness) {
          case 'ready':
            filteredStudents = filteredStudents.filter(s => s.placementScore >= 70);
            break;
          case 'not-ready':
            filteredStudents = filteredStudents.filter(s => s.placementScore < 70);
            break;
          case 'high-potential':
            filteredStudents = filteredStudents.filter(s => s.placementScore >= 85);
            break;
        }
      }

      // Filter by department if specified
      if (department) {
        filteredStudents = filteredStudents.filter(s => s.department === department);
      }

      const response: AdminResponse = {
        success: true,
        data: filteredStudents
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch students by readiness'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Update student profile (placement-focused)
   */
  static async updateStudentProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as ProfileUpdateRequest;

      // Focus on placement-relevant fields
      const placementFocusedUpdate: ProfileUpdateRequest = {
        skills: updateData.skills,
        resumeUrl: updateData.resumeUrl,
        linkedIn: updateData.linkedIn,
        github: updateData.github,
        bio: updateData.bio,
        contactInfo: updateData.contactInfo,
        phoneNumber: updateData.phoneNumber,
        alternateEmail: updateData.alternateEmail
      };

      const profile = await AdminProfileService.updateProfile(
        userId,
        placementFocusedUpdate,
        adminRequest.admin.collegeId,
        adminRequest.admin.id
      );

      await logAdminAction(
        request, 
        'UPDATE_PROFILE', 
        'PROFILE', 
        userId, 
        { updateData: placementFocusedUpdate, scope: 'PLACEMENT' }
      );

      const response: AdminResponse = {
        success: true,
        data: profile,
        message: 'Student profile updated successfully'
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
   * Award placement-related badge
   */
  static async awardPlacementBadge(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const awardData = request.body as BadgeAwardRequest;

      // Verify this is a placement-relevant badge
      // This would check badge categories like 'PLACEMENT', 'SKILL', 'PROJECT'
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
          scope: 'PLACEMENT'
        }
      );

      const response: AdminResponse = {
        success: true,
        data: studentBadge,
        message: 'Placement badge awarded successfully'
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
   * Get placement analytics
   */
  static async getPlacementAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { type } = request.query as { type?: string };
      const collegeId = adminRequest.admin.collegeId;

      let analyticsData;

      switch (type) {
        case 'skills':
          analyticsData = await AdminAnalyticsService.getSkillTrendAnalysis(collegeId);
          break;
        case 'readiness':
          analyticsData = await AdminAnalyticsService.getPlacementReadinessReport(collegeId);
          break;
        case 'department-wise':
          const readinessReport = await AdminAnalyticsService.getPlacementReadinessReport(collegeId);
          analyticsData = readinessReport.departmentSummary;
          break;
        default:
          // Combined placement analytics
          const [skillTrends, placementReadiness] = await Promise.all([
            AdminAnalyticsService.getSkillTrendAnalysis(collegeId),
            AdminAnalyticsService.getPlacementReadinessReport(collegeId)
          ]);
          analyticsData = { skillTrends, placementReadiness };
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
   * Generate placement report
   */
  static async generatePlacementReport(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { department, year, format } = request.query as { 
        department?: string; 
        year?: string; 
        format?: string 
      };

      const placementReport = await AdminAnalyticsService.getPlacementReadinessReport(
        adminRequest.admin.collegeId
      );

      let filteredStudents = placementReport.students;

      // Apply filters
      if (department) {
        filteredStudents = filteredStudents.filter(s => s.department === department);
      }
      if (year) {
        filteredStudents = filteredStudents.filter(s => s.year === parseInt(year));
      }

      // Generate report data
      const reportData = {
        summary: {
          totalStudents: filteredStudents.length,
          readyStudents: filteredStudents.filter(s => s.placementScore >= 70).length,
          averageScore: filteredStudents.reduce((sum, s) => sum + s.placementScore, 0) / filteredStudents.length,
          topPerformers: filteredStudents
            .sort((a, b) => b.placementScore - a.placementScore)
            .slice(0, 10)
        },
        students: filteredStudents,
        departmentSummary: placementReport.departmentSummary,
        skillAnalysis: await AdminAnalyticsService.getSkillTrendAnalysis(adminRequest.admin.collegeId)
      };

      await logAdminAction(
        request, 
        'GENERATE_REPORT', 
        'PLACEMENT_REPORT', 
        undefined, 
        { department, year, format }
      );

      if (format === 'csv') {
        // Generate CSV
        const headers = ['Name', 'Department', 'Year', 'Placement Score', 'Skills', 'Projects', 'Badges', 'Recommendations'];
        const rows = filteredStudents.map(student => [
          student.displayName,
          student.department,
          student.year,
          student.placementScore,
          student.skillCount,
          student.projectCount,
          student.badgeCount,
          student.recommendations.join('; ')
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
        ].join('\n');

        const filename = `placement-report-${new Date().toISOString().split('T')[0]}.csv`;
        
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(csvContent);
      }

      const response: AdminResponse = {
        success: true,
        data: reportData
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate report'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get skill demand analysis
   */
  static async getSkillDemandAnalysis(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      
      const skillTrends = await AdminAnalyticsService.getSkillTrendAnalysis(
        adminRequest.admin.collegeId
      );

      // Focus on industry demand and placement relevance
      const demandAnalysis = {
        trendingSkills: skillTrends.trendingSkills.slice(0, 20),
        skillGaps: skillTrends.skillGaps,
        industryAlignment: skillTrends.industryAlignment,
        recommendations: [
          'Focus on AI/ML skills for better placement opportunities',
          'Cloud computing skills are in high demand',
          'Full-stack development remains popular',
          'Data science and analytics skills show strong growth'
        ]
      };

      const response: AdminResponse = {
        success: true,
        data: demandAnalysis
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch skill demand analysis'
      };
      return reply.status(500).send(response);
    }
  }

  // Private helper methods
  private static calculatePlacementScore(profile: any): number {
    let score = 0;
    
    // Profile completion (30%)
    const completionScore = profile.completionStatus?.percentage || 0;
    score += completionScore * 0.3;
    
    // Skills (25%)
    const skillCount = profile.skills?.length || 0;
    score += Math.min(skillCount * 5, 25);
    
    // Projects (25%)
    const projectCount = profile.personalProjects?.length || 0;
    score += Math.min(projectCount * 8, 25);
    
    // Badges (10%)
    const badgeCount = profile.studentBadges?.length || 0;
    score += Math.min(badgeCount * 2, 10);
    
    // Resume and LinkedIn (10%)
    if (profile.resumeUrl) score += 5;
    if (profile.linkedIn) score += 5;
    
    return Math.min(Math.round(score), 100);
  }

  private static getPlacementRecommendations(profile: any): string[] {
    const recommendations: string[] = [];
    
    if (!profile.resumeUrl) {
      recommendations.push('Upload an updated resume');
    }
    
    if (!profile.linkedIn) {
      recommendations.push('Create a LinkedIn profile');
    }
    
    if (!profile.skills || profile.skills.length < 5) {
      recommendations.push('Add more technical skills');
    }
    
    if (!profile.personalProjects || profile.personalProjects.length < 2) {
      recommendations.push('Add more projects to showcase your abilities');
    }
    
    if (!profile.github) {
      recommendations.push('Create a GitHub profile to showcase your code');
    }
    
    if (!profile.bio || profile.bio.length < 100) {
      recommendations.push('Write a compelling bio highlighting your strengths');
    }
    
    return recommendations;
  }
}
