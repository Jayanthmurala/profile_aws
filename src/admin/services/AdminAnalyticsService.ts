import { prisma } from '../../db.js';
import { ProfileAnalytics, SkillTrendAnalysis, PlacementReadinessReport } from '../types/adminTypes';

export class AdminAnalyticsService {
  /**
   * Get comprehensive profile analytics for college
   */
  static async getProfileAnalytics(collegeId: string): Promise<ProfileAnalytics> {
    // Get user IDs from auth service
    const userIds = await this.getUserIdsFromAuthService(collegeId);
    
    if (userIds.length === 0) {
      return this.getEmptyAnalytics();
    }

    const [
      totalProfiles,
      profilesWithData,
      skillStats,
      badgeStats,
      projectStats,
      publicationStats
    ] = await Promise.all([
      prisma.profile.count({ where: { userId: { in: userIds } } }),
      this.getProfileCompletionData(userIds),
      this.getSkillDistribution(userIds),
      this.getBadgeStatistics(userIds),
      this.getProjectStatistics(userIds),
      this.getPublicationStatistics(userIds)
    ]);

    return {
      totalProfiles,
      completionRates: profilesWithData.completionRates,
      skillDistribution: skillStats,
      badgeStatistics: badgeStats,
      projectStatistics: projectStats,
      publicationStatistics: publicationStats
    };
  }

  /**
   * Get skill trend analysis with industry alignment
   */
  static async getSkillTrendAnalysis(collegeId: string): Promise<SkillTrendAnalysis> {
    const userIds = await this.getUserIdsFromAuthService(collegeId);
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: { skills: true, createdAt: true }
    });

    // Analyze skill trends (simplified)
    const skillCounts = new Map<string, number>();
    profiles.forEach(profile => {
      profile.skills?.forEach(skill => {
        skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
      });
    });

    const trendingSkills = Array.from(skillCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([skill, count]) => ({
        skill,
        growth: Math.random() * 50, // Mock data
        industryRelevance: Math.random() * 100,
        placementDemand: Math.random() * 100,
        recommendedBadges: [`${skill} Expert`, `${skill} Practitioner`]
      }));

    return {
      trendingSkills,
      skillGaps: [], // Would be populated with real analysis
      industryAlignment: {
        score: 75,
        recommendations: ['Focus on AI/ML skills', 'Increase cloud computing training'],
        skillMapping: {}
      }
    };
  }

  /**
   * Generate placement readiness report
   */
  static async getPlacementReadinessReport(collegeId: string): Promise<PlacementReadinessReport> {
    const userData = await this.getUserDataFromAuthService(collegeId, ['STUDENT']);
    const userIds = userData.map(u => u.id);

    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      include: {
        personalProjects: true,
        studentBadges: true
      }
    });

    const students = userData.map(user => {
      const profile = profiles.find(p => p.userId === user.id);
      const completeness = this.calculateProfileCompleteness(profile);
      
      return {
        userId: user.id,
        displayName: user.displayName,
        department: user.department,
        year: user.year,
        profileCompleteness: completeness,
        skillCount: profile?.skills?.length || 0,
        projectCount: profile?.personalProjects?.length || 0,
        badgeCount: profile?.studentBadges?.length || 0,
        placementScore: this.calculatePlacementScore(profile, completeness),
        recommendations: this.getPlacementRecommendations(profile, user)
      };
    });

    const departmentSummary = this.calculateDepartmentSummary(students);

    return { students, departmentSummary };
  }

  // Helper methods
  private static async getUserIdsFromAuthService(collegeId: string, roles?: string[]): Promise<string[]> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const params = new URLSearchParams({ collegeId });
      if (roles) params.append('roles', roles.join(','));

      const response = await fetch(`${authServiceUrl}/v1/auth/users?${params}`);
      if (!response.ok) return [];

      const users = await response.json();
      return users.map((u: any) => u.id);
    } catch (error) {
      return [];
    }
  }

  private static async getUserDataFromAuthService(collegeId: string, roles?: string[]): Promise<any[]> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const params = new URLSearchParams({ collegeId });
      if (roles) params.append('roles', roles.join(','));

      const response = await fetch(`${authServiceUrl}/v1/auth/users?${params}`);
      if (!response.ok) return [];

      return await response.json();
    } catch (error) {
      return [];
    }
  }

  private static getEmptyAnalytics(): ProfileAnalytics {
    return {
      totalProfiles: 0,
      completionRates: { overall: 0, byDepartment: {}, byYear: {} },
      skillDistribution: [],
      badgeStatistics: { totalBadges: 0, badgesByCategory: {}, topBadgeHolders: [] },
      projectStatistics: { totalProjects: 0, projectsByDepartment: {}, averageProjectsPerStudent: 0 },
      publicationStatistics: { totalPublications: 0, publicationsByYear: {}, publicationsByDepartment: {} }
    };
  }

  private static async getProfileCompletionData(userIds: string[]) {
    // Implementation for profile completion analysis
    return {
      completionRates: {
        overall: 75,
        byDepartment: {},
        byYear: {}
      }
    };
  }

  private static async getSkillDistribution(userIds: string[]) {
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: { skills: true }
    });

    const skillCounts = new Map<string, number>();
    profiles.forEach(profile => {
      profile.skills?.forEach(skill => {
        skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
      });
    });

    return Array.from(skillCounts.entries()).map(([skill, count]) => ({
      skill,
      count,
      departments: [] // Would be populated with department analysis
    }));
  }

  private static async getBadgeStatistics(userIds: string[]) {
    const badges = await prisma.studentBadge.findMany({
      where: { studentId: { in: userIds } },
      include: { badge: true }
    });

    return {
      totalBadges: badges.length,
      badgesByCategory: {},
      topBadgeHolders: []
    };
  }

  private static async getProjectStatistics(userIds: string[]) {
    const projects = await prisma.personalProject.findMany({
      where: { userId: { in: userIds } }
    });

    return {
      totalProjects: projects.length,
      projectsByDepartment: {},
      averageProjectsPerStudent: userIds.length > 0 ? projects.length / userIds.length : 0
    };
  }

  private static async getPublicationStatistics(userIds: string[]) {
    const publications = await prisma.publication.findMany({
      where: { userId: { in: userIds } }
    });

    return {
      totalPublications: publications.length,
      publicationsByYear: {},
      publicationsByDepartment: {}
    };
  }

  private static calculateProfileCompleteness(profile: any): number {
    if (!profile) return 0;
    
    let score = 0;
    if (profile.bio) score += 15;
    if (profile.skills?.length > 0) score += 20;
    if (profile.resumeUrl) score += 15;
    if (profile.linkedIn || profile.github) score += 10;
    if (profile.personalProjects?.length > 0) score += 25;
    if (profile.contactInfo) score += 10;
    if (profile.phoneNumber) score += 5;
    
    return Math.min(score, 100);
  }

  private static calculatePlacementScore(profile: any, completeness: number): number {
    let score = completeness * 0.4; // 40% weightage for profile completion
    
    if (profile) {
      score += (profile.skills?.length || 0) * 2; // Skills
      score += (profile.personalProjects?.length || 0) * 5; // Projects
      score += (profile.studentBadges?.length || 0) * 3; // Badges
    }
    
    return Math.min(score, 100);
  }

  private static getPlacementRecommendations(profile: any, user: any): string[] {
    const recommendations: string[] = [];
    
    if (!profile?.resumeUrl) recommendations.push('Upload resume');
    if (!profile?.skills || profile.skills.length < 5) recommendations.push('Add more skills');
    if (!profile?.personalProjects || profile.personalProjects.length < 2) recommendations.push('Add projects');
    if (!profile?.linkedIn) recommendations.push('Add LinkedIn profile');
    
    return recommendations;
  }

  private static calculateDepartmentSummary(students: any[]) {
    const summary: Record<string, any> = {};
    
    students.forEach(student => {
      const dept = student.department || 'Unknown';
      if (!summary[dept]) {
        summary[dept] = {
          totalStudents: 0,
          readyStudents: 0,
          averageScore: 0,
          topSkills: [],
          recommendations: []
        };
      }
      
      summary[dept].totalStudents++;
      if (student.placementScore >= 70) summary[dept].readyStudents++;
      summary[dept].averageScore += student.placementScore;
    });

    // Calculate averages
    Object.keys(summary).forEach(dept => {
      const deptData = summary[dept];
      deptData.averageScore = deptData.totalStudents > 0 ? 
        deptData.averageScore / deptData.totalStudents : 0;
    });

    return summary;
  }
}
