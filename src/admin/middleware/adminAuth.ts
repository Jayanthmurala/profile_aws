import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminContext, AdminPermissions } from '../types/adminTypes';

export interface AdminRequest extends FastifyRequest {
  admin: AdminContext;
}

/**
 * Base admin authentication middleware
 * Verifies JWT token and ensures user has admin role
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7);
    
    // Verify token with auth service
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
    const response = await fetch(`${authServiceUrl}/v1/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return reply.status(401).send({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const userInfo = await response.json();

    if (!userInfo.collegeId) {
      return reply.status(401).send({
        success: false,
        message: 'User must be associated with a college'
      });
    }

    // Check if user has any admin role
    const hasAdminRole = userInfo.roles?.some((role: string) => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
    );

    if (!hasAdminRole) {
      return reply.status(403).send({
        success: false,
        message: 'Admin role required'
      });
    }

    // Attach admin context to request
    (request as AdminRequest).admin = {
      id: userInfo.id,
      email: userInfo.email,
      displayName: userInfo.displayName,
      roles: userInfo.roles,
      collegeId: userInfo.collegeId,
      department: userInfo.department,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    };

  } catch (error) {
    request.log.error({ error }, 'Admin auth middleware error');
    return reply.status(401).send({
      success: false,
      message: 'Authentication failed'
    });
  }
}

/**
 * HEAD_ADMIN specific middleware
 */
export async function requireHeadAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasHeadAdminRole = adminRequest.admin.roles.some(role => 
    ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
  );

  if (!hasHeadAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'HEAD_ADMIN or SUPER_ADMIN role required'
    });
  }
}

/**
 * DEPT_ADMIN specific middleware
 */
export async function requireDeptAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasDeptAdminRole = adminRequest.admin.roles.some(role => 
    ['DEPT_ADMIN', 'HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
  );

  if (!hasDeptAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'DEPT_ADMIN, HEAD_ADMIN, or SUPER_ADMIN role required'
    });
  }

  // DEPT_ADMIN must have a department assigned
  if (adminRequest.admin.roles.includes('DEPT_ADMIN') && !adminRequest.admin.department) {
    return reply.status(403).send({
      success: false,
      message: 'Department assignment required for DEPT_ADMIN'
    });
  }
}

/**
 * PLACEMENTS_ADMIN specific middleware
 */
export async function requirePlacementsAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasPlacementsAdminRole = adminRequest.admin.roles.some(role => 
    ['PLACEMENTS_ADMIN', 'HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
  );

  if (!hasPlacementsAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'PLACEMENTS_ADMIN, HEAD_ADMIN, or SUPER_ADMIN role required'
    });
  }
}

/**
 * Get admin permissions based on role
 */
export function getAdminPermissions(roles: string[]): AdminPermissions {
  const isHeadAdmin = roles.includes('HEAD_ADMIN');
  const isDeptAdmin = roles.includes('DEPT_ADMIN');
  const isPlacementsAdmin = roles.includes('PLACEMENTS_ADMIN');
  const isSuperAdmin = roles.includes('SUPER_ADMIN');

  if (isSuperAdmin || isHeadAdmin) {
    return {
      canEditProfiles: true,
      canCreateBadges: true,
      canAwardBadges: true,
      canRevokeBadges: true,
      canModerateContent: true,
      canSetRequirements: true,
      canViewAnalytics: true,
      canExportData: true,
      canBulkOperations: true,
      scope: "COLLEGE"
    };
  }

  if (isDeptAdmin) {
    return {
      canEditProfiles: true,
      canCreateBadges: false, // Only HEAD_ADMIN can create badges
      canAwardBadges: true,
      canRevokeBadges: false, // Cannot revoke badges
      canModerateContent: true,
      canSetRequirements: false,
      canViewAnalytics: true,
      canExportData: true,
      canBulkOperations: true,
      scope: "DEPARTMENT"
    };
  }

  if (isPlacementsAdmin) {
    return {
      canEditProfiles: true, // Limited to placement-relevant fields
      canCreateBadges: false,
      canAwardBadges: true, // Placement-related badges only
      canRevokeBadges: false,
      canModerateContent: false,
      canSetRequirements: false,
      canViewAnalytics: true,
      canExportData: true,
      canBulkOperations: false,
      scope: "PLACEMENT"
    };
  }

  // Default permissions (no admin role)
  return {
    canEditProfiles: false,
    canCreateBadges: false,
    canAwardBadges: false,
    canRevokeBadges: false,
    canModerateContent: false,
    canSetRequirements: false,
    canViewAnalytics: false,
    canExportData: false,
    canBulkOperations: false,
    scope: "COLLEGE"
  };
}

/**
 * Check if admin can manage profile
 */
export function canManageProfile(
  adminRoles: string[],
  adminCollegeId: string,
  adminDepartment: string | undefined,
  targetProfile: { collegeId: string; department?: string; userId: string }
): boolean {
  const isHeadAdmin = adminRoles.includes('HEAD_ADMIN');
  const isDeptAdmin = adminRoles.includes('DEPT_ADMIN');
  const isPlacementsAdmin = adminRoles.includes('PLACEMENTS_ADMIN');
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN');

  // SUPER_ADMIN can manage any profile
  if (isSuperAdmin) {
    return true;
  }

  // Must be in same college
  if (targetProfile.collegeId !== adminCollegeId) {
    return false;
  }

  // HEAD_ADMIN can manage any profile in their college
  if (isHeadAdmin) {
    return true;
  }

  // DEPT_ADMIN can only manage profiles in their department
  if (isDeptAdmin) {
    return targetProfile.department === adminDepartment;
  }

  // PLACEMENTS_ADMIN can manage student profiles in their college
  if (isPlacementsAdmin) {
    return true; // Will be further filtered in services
  }

  return false;
}

/**
 * Check if admin can manage badge
 */
export function canManageBadge(
  adminRoles: string[],
  adminCollegeId: string,
  badge: { collegeId?: string; createdBy?: string }
): boolean {
  const isHeadAdmin = adminRoles.includes('HEAD_ADMIN');
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN');

  // SUPER_ADMIN can manage any badge
  if (isSuperAdmin) {
    return true;
  }

  // HEAD_ADMIN can manage college-specific badges in their college
  if (isHeadAdmin) {
    // Can manage badges that belong to their college or are college-specific
    return badge.collegeId === adminCollegeId || badge.collegeId === null;
  }

  return false;
}

/**
 * Check if admin can revoke specific badge award
 */
export function canRevokeBadgeAward(
  adminRoles: string[],
  adminCollegeId: string,
  badgeAward: { 
    awardedBy: string; 
    badge: { collegeId?: string };
    student: { collegeId: string };
  }
): boolean {
  const isHeadAdmin = adminRoles.includes('HEAD_ADMIN');
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN');

  // SUPER_ADMIN can revoke any badge
  if (isSuperAdmin) {
    return true;
  }

  // HEAD_ADMIN can revoke badges in their college, but not those awarded by SUPER_ADMIN
  if (isHeadAdmin && badgeAward.student.collegeId === adminCollegeId) {
    // Check if the badge was awarded by SUPER_ADMIN (cannot revoke)
    // This would require checking the awardedBy user's role, which we'd need to fetch
    return true; // Simplified for now, would need additional service call
  }

  return false;
}
