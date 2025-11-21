/**
 * College Access Validation Middleware
 * Enforces college-level data isolation
 * 
 * Rules:
 * 1. Users can access profiles from their own college
 * 2. Admins can access profiles from any college
 * 3. Cross-college access is denied for regular users
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthServiceClient } from '../utils/AuthServiceClient.js';

/**
 * Check if user can access another user's profile
 * 
 * Access Rules:
 * 1. Own profile - always allowed
 * 2. HEAD_ADMIN/SUPER_ADMIN - always allowed
 * 3. Same college - allowed
 * 4. Different college - denied
 */
export async function validateCollegeAccess(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { userId } = request.params as { userId: string };
    const currentUserId = (request as any).user?.sub;
    const currentUserRoles = (request as any).user?.roles || [];
    const currentUserCollege = (request as any).user?.collegeId;

    // Own profile - always allowed
    if (userId === currentUserId) {
      return;
    }

    // HEAD_ADMIN or SUPER_ADMIN - always allowed
    if (
      currentUserRoles.includes('HEAD_ADMIN') ||
      currentUserRoles.includes('SUPER_ADMIN')
    ) {
      request.log.info(
        {
          currentUserId,
          targetUserId: userId,
          roles: currentUserRoles,
          reason: 'admin_access',
        },
        'Admin accessing profile from different college'
      );
      return;
    }

    // If no college info in JWT, deny access (safety check)
    if (!currentUserCollege) {
      request.log.warn(
        {
          currentUserId,
          targetUserId: userId,
          reason: 'no_college_in_token',
        },
        'Denying access - no college info in token'
      );
      return reply.code(403).send({
        success: false,
        message: 'Access denied: College information missing',
      });
    }

    // Fetch target user's college from auth service
    const authHeader = request.headers.authorization || '';
    const targetUser = await AuthServiceClient.getUser(userId, authHeader);

    if (!targetUser) {
      request.log.warn(
        {
          currentUserId,
          targetUserId: userId,
          reason: 'target_user_not_found',
        },
        'Target user not found in auth service'
      );
      return reply.code(404).send({
        success: false,
        message: 'User not found',
      });
    }

    // Check college match
    if (targetUser.collegeId !== currentUserCollege) {
      request.log.warn(
        {
          currentUserId,
          targetUserId: userId,
          currentUserCollege,
          targetUserCollege: targetUser.collegeId,
          reason: 'cross_college_access_denied',
        },
        'Cross-college access denied'
      );
      return reply.code(403).send({
        success: false,
        message: 'Access denied: Cross-college access not allowed',
      });
    }

    // Same college - allowed
    request.log.info(
      {
        currentUserId,
        targetUserId: userId,
        college: currentUserCollege,
        reason: 'same_college_access',
      },
      'Same college access granted'
    );
    return;
  } catch (error) {
    request.log.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: (request.params as any).userId,
      },
      'College access validation failed'
    );
    return reply.code(500).send({
      success: false,
      message: 'Failed to validate access permissions',
    });
  }
}

/**
 * Middleware factory for college-scoped operations
 * Ensures user can only operate on data from their college
 */
export function requireCollegeScope(
  fieldName: string = 'collegeId'
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userCollege = (request as any).user?.collegeId;
    const userRoles = (request as any).user?.roles || [];

    // Admins bypass college scope check
    if (
      userRoles.includes('HEAD_ADMIN') ||
      userRoles.includes('SUPER_ADMIN')
    ) {
      return;
    }

    // Get college from request body or params
    let requestCollege = null;

    if (request.body && typeof request.body === 'object') {
      requestCollege = (request.body as any)[fieldName];
    }

    if (!requestCollege && request.params) {
      requestCollege = (request.params as any)[fieldName];
    }

    // If college is specified, verify it matches user's college
    if (requestCollege && requestCollege !== userCollege) {
      request.log.warn(
        {
          userId: (request as any).user?.sub,
          userCollege,
          requestCollege,
          reason: 'college_scope_violation',
        },
        'College scope violation detected'
      );
      return reply.code(403).send({
        success: false,
        message: 'Access denied: Cannot access data from other colleges',
      });
    }

    return;
  };
}

/**
 * Middleware to auto-inject user's college into request body
 * Useful for operations where college should be auto-scoped
 */
export function autoScopeCollege(
  fieldName: string = 'collegeId'
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userCollege = (request as any).user?.collegeId;
    const userRoles = (request as any).user?.roles || [];

    // Only auto-scope for non-admins
    if (
      !userRoles.includes('HEAD_ADMIN') &&
      !userRoles.includes('SUPER_ADMIN')
    ) {
      if (request.body && typeof request.body === 'object') {
        (request.body as any)[fieldName] = userCollege;
      }
    }

    return;
  };
}
