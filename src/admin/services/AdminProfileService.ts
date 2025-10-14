import { prisma } from '../../db.js';
import { 
  ProfileUpdateRequest, 
  BulkProfileOperation, 
  BulkOperationResult,
  ProfileFilters,
  PaginationParams,
  ADMIN_LIMITS,
  ModerationRequest,
  ProfileRequirementsConfig
} from '../types/adminTypes';

export class AdminProfileService {
  /**
   * Get profiles with filtering and pagination
   */
  static async getProfiles(
    filters: ProfileFilters,
    pagination: PaginationParams,
    adminCollegeId: string,
    adminDepartment?: string,
    adminScope: 'COLLEGE' | 'DEPARTMENT' | 'PLACEMENT' = 'COLLEGE'
  ) {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100);

    // First, get user IDs from auth service based on college/department scope
    const userIds = await this.getFilteredUserIds(filters, adminCollegeId, adminDepartment, adminScope);

    if (userIds.length === 0) {
      return {
        profiles: [],
        pagination: { page, limit: take, total: 0, totalPages: 0 }
      };
    }

    // Build where clause for profiles
    const where: any = {
      userId: { in: userIds }
    };

    // Apply additional filters
    if (filters.skills && filters.skills.length > 0) {
      where.skills = { hasSome: filters.skills };
    }

    if (filters.hasProjects !== undefined) {
      if (filters.hasProjects) {
        where.personalProjects = { some: {} };
      } else {
        where.personalProjects = { none: {} };
      }
    }

    if (filters.hasPublications !== undefined) {
      if (filters.hasPublications) {
        where.publications = { some: {} };
      } else {
        where.publications = { none: {} };
      }
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { bio: { contains: filters.search, mode: 'insensitive' } },
        { skills: { hasSome: [filters.search] } }
      ];
    }

    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {};
      if (filters.createdAfter) where.createdAt.gte = filters.createdAfter;
      if (filters.createdBefore) where.createdAt.lte = filters.createdBefore;
    }

    const [profiles, total] = await Promise.all([
      prisma.profile.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          personalProjects: true,
          publications: true,
          experiences: true,
          studentBadges: {
            include: {
              badge: true
            }
          }
        }
      }),
      prisma.profile.count({ where })
    ]);

    // Enrich profiles with user data from auth service
    const enrichedProfiles = await this.enrichProfilesWithUserData(profiles);

    return {
      profiles: enrichedProfiles,
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Get single profile with full details
   */
  static async getProfileById(userId: string, adminCollegeId: string) {
    // Check if user belongs to admin's college
    const hasAccess = await this.checkProfileAccess(userId, adminCollegeId);
    if (!hasAccess) {
      throw new Error('Profile not found or access denied');
    }

    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        personalProjects: true,
        publications: true,
        experiences: true,
        studentBadges: {
          include: {
            badge: true
          },
          orderBy: { awardedAt: 'desc' }
        }
      }
    });

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Enrich with user data
    const enrichedProfile = await this.enrichProfileWithUserData(profile);
    
    // Add completion status
    const completionStatus = await this.calculateProfileCompletion(profile);
    
    return {
      ...enrichedProfile,
      completionStatus
    };
  }

  /**
   * Update profile (admin override)
   */
  static async updateProfile(
    userId: string,
    updates: ProfileUpdateRequest,
    adminCollegeId: string,
    adminId: string
  ) {
    // Check access
    const hasAccess = await this.checkProfileAccess(userId, adminCollegeId);
    if (!hasAccess) {
      throw new Error('Profile not found or access denied');
    }

    // Separate profile updates from user updates
    const profileUpdates: any = {};
    const userUpdates: any = {};

    // Profile model fields
    if (updates.name !== undefined) profileUpdates.name = updates.name;
    if (updates.bio !== undefined) profileUpdates.bio = updates.bio;
    if (updates.skills !== undefined) profileUpdates.skills = updates.skills;
    if (updates.expertise !== undefined) profileUpdates.expertise = updates.expertise;
    if (updates.linkedIn !== undefined) profileUpdates.linkedIn = updates.linkedIn;
    if (updates.github !== undefined) profileUpdates.github = updates.github;
    if (updates.twitter !== undefined) profileUpdates.twitter = updates.twitter;
    if (updates.resumeUrl !== undefined) profileUpdates.resumeUrl = updates.resumeUrl;
    if (updates.contactInfo !== undefined) profileUpdates.contactInfo = updates.contactInfo;
    if (updates.phoneNumber !== undefined) profileUpdates.phoneNumber = updates.phoneNumber;
    if (updates.alternateEmail !== undefined) profileUpdates.alternateEmail = updates.alternateEmail;

    // User model fields (need to update via auth service)
    if (updates.displayName !== undefined) userUpdates.displayName = updates.displayName;
    if (updates.avatarUrl !== undefined) userUpdates.avatarUrl = updates.avatarUrl;
    if (updates.year !== undefined) userUpdates.year = updates.year;
    if (updates.department !== undefined) userUpdates.department = updates.department;

    // Update profile in database
    let updatedProfile;
    if (Object.keys(profileUpdates).length > 0) {
      updatedProfile = await prisma.profile.update({
        where: { userId },
        data: profileUpdates,
        include: {
          personalProjects: true,
          publications: true,
          experiences: true,
          studentBadges: {
            include: { badge: true }
          }
        }
      });
    } else {
      updatedProfile = await prisma.profile.findUnique({
        where: { userId },
        include: {
          personalProjects: true,
          publications: true,
          experiences: true,
          studentBadges: {
            include: { badge: true }
          }
        }
      });
    }

    // Update user fields via auth service if needed
    if (Object.keys(userUpdates).length > 0) {
      await this.updateUserViaAuthService(userId, userUpdates, adminId);
    }

    return this.enrichProfileWithUserData(updatedProfile!);
  }

  /**
   * Bulk profile operations
   */
  static async bulkOperation(
    operation: BulkProfileOperation,
    adminCollegeId: string,
    adminId: string
  ): Promise<BulkOperationResult> {
    if (operation.profiles.length > ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE) {
      throw new Error(`Maximum ${ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE} profiles allowed per bulk operation`);
    }

    const result: BulkOperationResult = {
      totalProcessed: operation.profiles.length,
      successful: 0,
      failed: 0,
      errors: [],
      preview: operation.preview
    };

    // If preview mode, validate without executing
    if (operation.preview) {
      for (let i = 0; i < operation.profiles.length; i++) {
        try {
          await this.validateBulkProfile(operation.action, operation.profiles[i], adminCollegeId);
          result.successful++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: operation.profiles[i]
          });
        }
      }
      return result;
    }

    // Execute bulk operation
    for (let i = 0; i < operation.profiles.length; i++) {
      try {
        const profileOp = operation.profiles[i];
        
        switch (operation.action) {
          case 'UPDATE':
            if (profileOp.data) {
              await this.updateProfile(profileOp.userId, profileOp.data, adminCollegeId, adminId);
            }
            break;
          case 'APPROVE':
            await this.approveProfileContent(profileOp.userId, adminId, profileOp.reason);
            break;
          case 'REJECT':
            await this.rejectProfileContent(profileOp.userId, adminId, profileOp.reason || 'Bulk rejection');
            break;
          case 'REQUIRE_COMPLETION':
            await this.requireProfileCompletion(profileOp.userId, adminCollegeId);
            break;
        }
        
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: operation.profiles[i]
        });
      }
    }

    return result;
  }

  /**
   * Get profile completion statistics
   */
  static async getCompletionStats(adminCollegeId: string, adminDepartment?: string) {
    const userIds = await this.getFilteredUserIds({}, adminCollegeId, adminDepartment);
    
    if (userIds.length === 0) {
      return {
        totalProfiles: 0,
        completionRates: { overall: 0, byDepartment: {}, byYear: {} },
        incompleteProfiles: []
      };
    }

    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      include: {
        personalProjects: true,
        publications: true,
        experiences: true
      }
    });

    const completionData = await Promise.all(
      profiles.map(async (profile) => ({
        userId: profile.userId,
        completion: await this.calculateProfileCompletion(profile)
      }))
    );

    // Get user data for department/year breakdown
    const userData = await this.getUserDataFromAuthService(userIds);
    
    const stats = {
      totalProfiles: profiles.length,
      completionRates: {
        overall: 0,
        byDepartment: {} as Record<string, number>,
        byYear: {} as Record<number, number>
      },
      incompleteProfiles: [] as any[]
    };

    // Calculate overall completion rate
    const totalCompletion = completionData.reduce((sum, data) => sum + data.completion.percentage, 0);
    stats.completionRates.overall = profiles.length > 0 ? totalCompletion / profiles.length : 0;

    // Calculate by department and year
    const departmentStats: Record<string, { total: number; completion: number }> = {};
    const yearStats: Record<number, { total: number; completion: number }> = {};

    completionData.forEach((data) => {
      const user = userData.find(u => u.id === data.userId);
      if (user) {
        // Department stats
        if (user.department) {
          if (!departmentStats[user.department]) {
            departmentStats[user.department] = { total: 0, completion: 0 };
          }
          departmentStats[user.department].total++;
          departmentStats[user.department].completion += data.completion.percentage;
        }

        // Year stats
        if (user.year) {
          if (!yearStats[user.year]) {
            yearStats[user.year] = { total: 0, completion: 0 };
          }
          yearStats[user.year].total++;
          yearStats[user.year].completion += data.completion.percentage;
        }

        // Track incomplete profiles
        if (data.completion.percentage < 80) {
          stats.incompleteProfiles.push({
            userId: data.userId,
            displayName: user.displayName,
            department: user.department,
            year: user.year,
            completion: data.completion.percentage,
            missing: data.completion.missing
          });
        }
      }
    });

    // Convert to percentages
    Object.keys(departmentStats).forEach(dept => {
      const stat = departmentStats[dept];
      stats.completionRates.byDepartment[dept] = stat.total > 0 ? stat.completion / stat.total : 0;
    });

    Object.keys(yearStats).forEach(year => {
      const stat = yearStats[parseInt(year)];
      stats.completionRates.byYear[parseInt(year)] = stat.total > 0 ? stat.completion / stat.total : 0;
    });

    return stats;
  }

  /**
   * Set profile requirements for college
   */
  static async setProfileRequirements(
    collegeId: string,
    requirements: ProfileRequirementsConfig
  ) {
    return await prisma.profileRequirements.upsert({
      where: { collegeId },
      update: {
        requireBio: requirements.requireBio,
        requireSkills: requirements.requireSkills,
        minSkillCount: requirements.minSkillCount,
        requireProjects: requirements.requireProjects,
        minProjectCount: requirements.minProjectCount,
        requireExperience: requirements.requireExperience,
        requireResume: requirements.requireResume,
        requireSocialLinks: requirements.requireSocialLinks,
        enforceForNetwork: requirements.enforceForNetwork,
        enforceForEvents: requirements.enforceForEvents,
        enforceForProjects: requirements.enforceForProjects,
        isActive: requirements.isActive
      },
      create: {
        collegeId: requirements.collegeId,
        requireBio: requirements.requireBio,
        requireSkills: requirements.requireSkills,
        minSkillCount: requirements.minSkillCount,
        requireProjects: requirements.requireProjects,
        minProjectCount: requirements.minProjectCount,
        requireExperience: requirements.requireExperience,
        requireResume: requirements.requireResume,
        requireSocialLinks: requirements.requireSocialLinks,
        enforceForNetwork: requirements.enforceForNetwork,
        enforceForEvents: requirements.enforceForEvents,
        enforceForProjects: requirements.enforceForProjects,
        isActive: requirements.isActive
      }
    });
  }

  /**
   * Get profile requirements for college
   */
  static async getProfileRequirements(collegeId: string) {
    return await prisma.profileRequirements.findUnique({
      where: { collegeId }
    });
  }

  // Private helper methods

  private static async getFilteredUserIds(
    filters: ProfileFilters,
    adminCollegeId: string,
    adminDepartment?: string,
    adminScope: 'COLLEGE' | 'DEPARTMENT' | 'PLACEMENT' = 'COLLEGE'
  ): Promise<string[]> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const queryParams = new URLSearchParams({
        collegeId: adminCollegeId
      });

      // Apply scope filtering
      if (adminScope === 'DEPARTMENT' && adminDepartment) {
        queryParams.append('department', adminDepartment);
      } else if (adminScope === 'PLACEMENT') {
        queryParams.append('roles', 'STUDENT');
      }

      // Apply additional filters
      if (filters.departments && filters.departments.length > 0) {
        queryParams.append('departments', filters.departments.join(','));
      }

      if (filters.years && filters.years.length > 0) {
        queryParams.append('years', filters.years.join(','));
      }

      const response = await fetch(`${authServiceUrl}/v1/auth/users?${queryParams}`);
      
      if (!response.ok) {
        return [];
      }

      const users = await response.json();
      return users.map((user: any) => user.id);
    } catch (error) {
      console.error('Error fetching filtered user IDs:', error);
      return [];
    }
  }

  private static async checkProfileAccess(userId: string, adminCollegeId: string): Promise<boolean> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const response = await fetch(`${authServiceUrl}/v1/auth/users/${userId}`);
      
      if (!response.ok) {
        return false;
      }

      const user = await response.json();
      return user.collegeId === adminCollegeId;
    } catch (error) {
      return false;
    }
  }

  private static async enrichProfilesWithUserData(profiles: any[]): Promise<any[]> {
    const userIds = profiles.map(p => p.userId);
    const userData = await this.getUserDataFromAuthService(userIds);
    
    return profiles.map(profile => {
      const user = userData.find(u => u.id === profile.userId);
      return {
        ...profile,
        user: user || null
      };
    });
  }

  private static async enrichProfileWithUserData(profile: any): Promise<any> {
    const userData = await this.getUserDataFromAuthService([profile.userId]);
    return {
      ...profile,
      user: userData[0] || null
    };
  }

  private static async getUserDataFromAuthService(userIds: string[]): Promise<any[]> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const response = await fetch(`${authServiceUrl}/v1/auth/users/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds })
      });

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching user data:', error);
      return [];
    }
  }

  private static async updateUserViaAuthService(userId: string, updates: any, adminId: string): Promise<void> {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      await fetch(`${authServiceUrl}/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'X-Admin-Id': adminId
        },
        body: JSON.stringify(updates)
      });
    } catch (error) {
      console.error('Error updating user via auth service:', error);
    }
  }

  private static async calculateProfileCompletion(profile: any): Promise<{ percentage: number; missing: string[] }> {
    const missing: string[] = [];
    let totalFields = 10;
    let completedFields = 0;

    // Check required fields
    if (profile.name) completedFields++; else missing.push('Name');
    if (profile.bio) completedFields++; else missing.push('Bio');
    if (profile.skills && profile.skills.length > 0) completedFields++; else missing.push('Skills');
    if (profile.linkedIn || profile.github) completedFields++; else missing.push('Social Links');
    if (profile.contactInfo) completedFields++; else missing.push('Contact Info');
    if (profile.resumeUrl) completedFields++; else missing.push('Resume');
    if (profile.personalProjects && profile.personalProjects.length > 0) completedFields++; else missing.push('Projects');
    if (profile.experiences && profile.experiences.length > 0) completedFields++; else missing.push('Experience');
    if (profile.phoneNumber) completedFields++; else missing.push('Phone Number');
    if (profile.alternateEmail) completedFields++; else missing.push('Alternate Email');

    return {
      percentage: Math.round((completedFields / totalFields) * 100),
      missing
    };
  }

  private static async validateBulkProfile(action: string, profileOp: any, adminCollegeId: string): Promise<void> {
    if (!profileOp.userId) {
      throw new Error('Missing userId');
    }

    const hasAccess = await this.checkProfileAccess(profileOp.userId, adminCollegeId);
    if (!hasAccess) {
      throw new Error(`Access denied for user ${profileOp.userId}`);
    }

    if (action === 'UPDATE' && !profileOp.data) {
      throw new Error('Missing update data');
    }
  }

  private static async approveProfileContent(userId: string, adminId: string, reason?: string): Promise<void> {
    // Implementation for content approval
    await prisma.profileModeration.updateMany({
      where: {
        userId,
        status: 'PENDING'
      },
      data: {
        status: 'APPROVED',
        moderatorId: adminId,
        reason,
        reviewedAt: new Date()
      }
    });
  }

  private static async rejectProfileContent(userId: string, adminId: string, reason: string): Promise<void> {
    // Implementation for content rejection
    await prisma.profileModeration.updateMany({
      where: {
        userId,
        status: 'PENDING'
      },
      data: {
        status: 'REJECTED',
        moderatorId: adminId,
        reason,
        reviewedAt: new Date()
      }
    });
  }

  private static async requireProfileCompletion(userId: string, collegeId: string): Promise<void> {
    // Check if profile meets requirements
    const requirements = await this.getProfileRequirements(collegeId);
    if (!requirements) return;

    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        personalProjects: true,
        experiences: true
      }
    });

    if (!profile) return;

    const completion = await this.calculateProfileCompletion(profile);
    
    if (completion.percentage < 80) {
      // Create moderation entry for incomplete profile
      await prisma.profileModeration.create({
        data: {
          profileId: profile.id,
          userId,
          status: 'PENDING',
          contentType: 'PROFILE',
          reason: `Profile completion required. Missing: ${completion.missing.join(', ')}`
        }
      });
    }
  }
}
