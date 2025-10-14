import { FastifyRequest } from 'fastify';
import { AdminRequest } from './adminAuth';

/**
 * Helper function to get college-scoped where clause
 */
export function getCollegeScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  
  // For profiles, we need to join with auth service to get collegeId
  // Since Profile model doesn't have collegeId directly
  return {
    ...additionalWhere,
    // This will be handled in services by fetching user info from auth service
  };
}

/**
 * Helper function to get department-scoped where clause for DEPT_ADMIN
 */
export function getDepartmentScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN');
  
  if (isDeptAdmin && adminRequest.admin.department) {
    return {
      ...additionalWhere,
      // Department filtering will be handled in services
      department: adminRequest.admin.department
    };
  }
  
  // For HEAD_ADMIN and SUPER_ADMIN, return college-scoped
  return getCollegeScopedWhere(request, additionalWhere);
}

/**
 * Helper function to get placement-scoped where clause for PLACEMENTS_ADMIN
 */
export function getPlacementScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  const isPlacementsAdmin = adminRequest.admin.roles.includes('PLACEMENTS_ADMIN');
  
  if (isPlacementsAdmin) {
    // Placements admin focuses on students with placement-relevant data
    return {
      ...additionalWhere,
      // Will filter for students with skills, projects, resume etc.
    };
  }
  
  // For HEAD_ADMIN and SUPER_ADMIN, return college-scoped
  return getCollegeScopedWhere(request, additionalWhere);
}

/**
 * Check if admin can access profile resource
 */
export async function canAccessProfileResource(
  request: FastifyRequest, 
  profileUserId: string
): Promise<boolean> {
  const adminRequest = request as AdminRequest;
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN');
  
  // SUPER_ADMIN can access any profile
  if (isSuperAdmin) {
    return true;
  }
  
  try {
    // Get user info from auth service to check college
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
    const response = await fetch(`${authServiceUrl}/v1/auth/users/${profileUserId}`, {
      headers: {
        'Authorization': request.headers.authorization || ''
      }
    });

    if (!response.ok) {
      return false;
    }

    const userInfo = await response.json();
    
    // Must be in same college
    if (userInfo.collegeId !== adminRequest.admin.collegeId) {
      return false;
    }

    // Additional department check for DEPT_ADMIN
    const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN');
    if (isDeptAdmin) {
      return userInfo.department === adminRequest.admin.department;
    }

    return true;
  } catch (error) {
    console.error('Error checking profile access:', error);
    return false;
  }
}

/**
 * Check if admin can access badge resource
 */
export async function canAccessBadgeResource(
  request: FastifyRequest, 
  badgeCollegeId: string | null
): Promise<boolean> {
  const adminRequest = request as AdminRequest;
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN');
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN');
  
  // SUPER_ADMIN can access any badge
  if (isSuperAdmin) {
    return true;
  }
  
  // HEAD_ADMIN can access global badges (null collegeId) and their college badges
  if (isHeadAdmin) {
    return badgeCollegeId === null || badgeCollegeId === adminRequest.admin.collegeId;
  }
  
  // Other admins can only access their college badges
  return badgeCollegeId === adminRequest.admin.collegeId;
}

/**
 * Get filtered user IDs based on admin scope
 */
export async function getFilteredUserIds(
  request: FastifyRequest,
  userIds?: string[]
): Promise<string[]> {
  const adminRequest = request as AdminRequest;
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN');
  
  // SUPER_ADMIN can access all users
  if (isSuperAdmin) {
    return userIds || [];
  }

  try {
    // Get users from auth service with college filtering
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
    const queryParams = new URLSearchParams({
      collegeId: adminRequest.admin.collegeId
    });

    if (userIds && userIds.length > 0) {
      queryParams.append('userIds', userIds.join(','));
    }

    const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN');
    if (isDeptAdmin && adminRequest.admin.department) {
      queryParams.append('department', adminRequest.admin.department);
    }

    const response = await fetch(`${authServiceUrl}/v1/auth/users?${queryParams}`, {
      headers: {
        'Authorization': request.headers.authorization || ''
      }
    });

    if (!response.ok) {
      return [];
    }

    const users = await response.json();
    return users.map((user: any) => user.id);
  } catch (error) {
    console.error('Error filtering user IDs:', error);
    return [];
  }
}

/**
 * Apply role-based filtering to profile queries
 */
export function applyRoleBasedFiltering(request: FastifyRequest, baseFilters: any) {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN');
  const isPlacementsAdmin = adminRequest.admin.roles.includes('PLACEMENTS_ADMIN');
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN');
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN');
  
  // SUPER_ADMIN can see all profiles (no additional filtering)
  if (isSuperAdmin) {
    return baseFilters;
  }
  
  // HEAD_ADMIN can see all profiles in their college
  if (isHeadAdmin) {
    return {
      ...baseFilters,
      collegeId: adminRequest.admin.collegeId
    };
  }
  
  // DEPT_ADMIN can only see profiles in their department
  if (isDeptAdmin) {
    return {
      ...baseFilters,
      collegeId: adminRequest.admin.collegeId,
      department: adminRequest.admin.department
    };
  }
  
  // PLACEMENTS_ADMIN can see student profiles in their college
  if (isPlacementsAdmin) {
    return {
      ...baseFilters,
      collegeId: adminRequest.admin.collegeId,
      roles: ['STUDENT'] // Only students
    };
  }
  
  // Default: college-scoped
  return {
    ...baseFilters,
    collegeId: adminRequest.admin.collegeId
  };
}

/**
 * Check badge award limits and permissions
 */
export async function checkBadgeAwardLimits(
  adminId: string,
  badgeDefinitionId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const { prisma } = await import('../../db.js');
  
  // Check daily badge award limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const todayAwards = await prisma.studentBadge.count({
    where: {
      awardedBy: adminId,
      awardedAt: {
        gte: today,
        lt: tomorrow
      }
    }
  });
  
  const MAX_DAILY_AWARDS = 100; // From ADMIN_LIMITS
  if (todayAwards >= MAX_DAILY_AWARDS) {
    return {
      allowed: false,
      reason: `Daily badge award limit of ${MAX_DAILY_AWARDS} reached`
    };
  }
  
  return { allowed: true };
}

/**
 * Get accessible departments for admin
 */
export function getAccessibleDepartments(request: FastifyRequest, allDepartments: string[]): string[] {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN');
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN');
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN');
  
  // SUPER_ADMIN and HEAD_ADMIN can access all departments
  if (isSuperAdmin || isHeadAdmin) {
    return allDepartments;
  }
  
  // DEPT_ADMIN can only access their own department
  if (isDeptAdmin && adminRequest.admin.department) {
    return allDepartments.filter(dept => dept === adminRequest.admin.department);
  }
  
  return [];
}

/**
 * Check if profile meets completion requirements
 */
export async function checkProfileCompletionRequirements(
  userId: string,
  collegeId: string,
  context: 'NETWORK' | 'EVENTS' | 'PROJECTS'
): Promise<{ meets: boolean; missing: string[] }> {
  const { prisma } = await import('../../db.js');
  
  try {
    // Get profile requirements for the college
    const requirements = await prisma.profileRequirements.findUnique({
      where: { collegeId }
    });
    
    if (!requirements || !requirements.isActive) {
      return { meets: true, missing: [] };
    }
    
    // Check if requirements apply to this context
    const enforceForContext = 
      (context === 'NETWORK' && requirements.enforceForNetwork) ||
      (context === 'EVENTS' && requirements.enforceForEvents) ||
      (context === 'PROJECTS' && requirements.enforceForProjects);
    
    if (!enforceForContext) {
      return { meets: true, missing: [] };
    }
    
    // Get profile data
    const profile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        personalProjects: true,
        experiences: true
      }
    });
    
    if (!profile) {
      return { meets: false, missing: ['Profile not found'] };
    }
    
    const missing: string[] = [];
    
    // Check bio requirement
    if (requirements.requireBio && !profile.bio) {
      missing.push('Bio');
    }
    
    // Check skills requirement
    if (requirements.requireSkills) {
      const skillCount = profile.skills?.length || 0;
      if (skillCount < requirements.minSkillCount) {
        missing.push(`Skills (minimum ${requirements.minSkillCount}, current: ${skillCount})`);
      }
    }
    
    // Check projects requirement
    if (requirements.requireProjects) {
      const projectCount = profile.personalProjects?.length || 0;
      if (projectCount < requirements.minProjectCount) {
        missing.push(`Projects (minimum ${requirements.minProjectCount}, current: ${projectCount})`);
      }
    }
    
    // Check experience requirement
    if (requirements.requireExperience && (!profile.experiences || profile.experiences.length === 0)) {
      missing.push('Experience');
    }
    
    // Check resume requirement
    if (requirements.requireResume && !profile.resumeUrl) {
      missing.push('Resume');
    }
    
    // Check social links requirement
    if (requirements.requireSocialLinks && !profile.linkedIn && !profile.github) {
      missing.push('Social Links (LinkedIn or GitHub)');
    }
    
    return {
      meets: missing.length === 0,
      missing
    };
  } catch (error) {
    console.error('Error checking profile completion requirements:', error);
    return { meets: false, missing: ['Error checking requirements'] };
  }
}
