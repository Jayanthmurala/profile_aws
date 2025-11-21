/**
 * PII (Personally Identifiable Information) Protection Middleware
 * Prevents leaking sensitive personal data to unauthorized users
 * 
 * Sensitive fields:
 * - phoneNumber
 * - alternateEmail
 * - contactInfo
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * List of PII fields that should be protected
 * PHASE 1 FIX: Added missing fields (resumeUrl, linkedIn, github, twitter, email)
 * These fields can be used to identify students even if phone/email are hidden
 */
const PII_FIELDS = [
  'phoneNumber',
  'alternateEmail',
  'contactInfo',
  'resumeUrl',      // PHASE 1: Can identify students by resume
  'linkedIn',       // PHASE 1: Can identify students by LinkedIn profile
  'github',         // PHASE 1: Can identify students by GitHub profile
  'twitter',        // PHASE 1: Can identify students by Twitter profile
  'email'           // PHASE 1: Email should be protected from non-admins
];

/**
 * Check if requester can access PII for a profile
 * 
 * Rules:
 * 1. Profile owner can always see their own PII
 * 2. HEAD_ADMIN can see all PII
 * 3. DEPT_ADMIN can see PII for users in their department
 * 4. Everyone else cannot see PII
 */
export function canAccessPII(
  requestingUserId: string | undefined,
  profileUserId: string,
  requestingUserRoles: string[] = [],
  requestingUserDept?: string,
  profileUserDept?: string
): boolean {
  // Own profile - always allowed
  if (requestingUserId === profileUserId) {
    return true;
  }

  // HEAD_ADMIN - always allowed
  if (requestingUserRoles.includes('HEAD_ADMIN')) {
    return true;
  }

  // SUPER_ADMIN - always allowed
  if (requestingUserRoles.includes('SUPER_ADMIN')) {
    return true;
  }

  // DEPT_ADMIN - allowed for same department
  if (requestingUserRoles.includes('DEPT_ADMIN')) {
    return requestingUserDept === profileUserDept && !!requestingUserDept;
  }

  // Everyone else - denied
  return false;
}

/**
 * Remove PII fields from profile object
 * Modifies the object in place
 */
export function removePII(profile: any): any {
  if (!profile) return profile;

  const cleaned = { ...profile };
  PII_FIELDS.forEach(field => {
    delete cleaned[field];
  });

  return cleaned;
}

/**
 * Protect PII in a profile object based on access rules
 * Returns the profile with PII removed if user doesn't have access
 */
export function protectPII(
  profile: any,
  requestingUserId: string | undefined,
  requestingUserRoles: string[] = [],
  requestingUserDept?: string
): any {
  if (!profile) return profile;

  const profileUserId = profile.userId;
  const profileUserDept = profile.department;

  // Check if user can access PII
  const hasAccess = canAccessPII(
    requestingUserId,
    profileUserId,
    requestingUserRoles,
    requestingUserDept,
    profileUserDept
  );

  // If no access, remove PII fields
  if (!hasAccess) {
    return removePII(profile);
  }

  return profile;
}

/**
 * Protect PII in an array of profiles
 */
export function protectPIIArray(
  profiles: any[],
  requestingUserId: string | undefined,
  requestingUserRoles: string[] = [],
  requestingUserDept?: string
): any[] {
  return profiles.map(profile =>
    protectPII(profile, requestingUserId, requestingUserRoles, requestingUserDept)
  );
}

/**
 * Middleware to automatically protect PII in responses
 * Usage: app.addHook('onSend', piiProtectionHook)
 */
export async function piiProtectionHook(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: any
) {
  // Only process JSON responses
  if (!payload || typeof payload !== 'string') {
    return payload;
  }

  try {
    const data = JSON.parse(payload);

    // Get user info from request
    const requestingUserId = (request as any).user?.sub;
    const requestingUserRoles = (request as any).user?.roles || [];
    const requestingUserDept = (request as any).user?.department;

    // Protect single profile
    if (data.profile && typeof data.profile === 'object') {
      data.profile = protectPII(
        data.profile,
        requestingUserId,
        requestingUserRoles,
        requestingUserDept
      );
    }

    // Protect profiles array
    if (data.profiles && Array.isArray(data.profiles)) {
      data.profiles = protectPIIArray(
        data.profiles,
        requestingUserId,
        requestingUserRoles,
        requestingUserDept
      );
    }

    // Protect users array
    if (data.users && Array.isArray(data.users)) {
      data.users = protectPIIArray(
        data.users,
        requestingUserId,
        requestingUserRoles,
        requestingUserDept
      );
    }

    return JSON.stringify(data);
  } catch (error) {
    // If parsing fails, return original payload
    return payload;
  }
}

/**
 * Audit log for PII access attempts
 */
export function logPIIAccess(
  requestingUserId: string | undefined,
  profileUserId: string,
  granted: boolean,
  request: FastifyRequest
) {
  const isOwn = requestingUserId === profileUserId;
  const action = granted ? 'pii_access_granted' : 'pii_access_denied';

  const logData = {
    action,
    requestingUserId,
    profileUserId,
    isOwnProfile: isOwn,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };

  if (granted) {
    request.log.info(logData, 'PII access granted');
  } else {
    request.log.warn(logData, 'PII access denied');
  }
}
