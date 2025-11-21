/**
 * Centralized JWT type definition
 * Single source of truth for JWT payload structure
 * Prevents fragmentation across multiple files
 */

import { JWTPayload as JoseJWTPayload } from 'jose';

/**
 * JWT Payload structure from auth-service
 * This is the contract between auth-service and profile-service
 * Any changes to auth-service JWT must update this type
 */
export interface JWTPayload extends JoseJWTPayload {
  // Required fields
  sub: string;                    // User ID (primary identifier)
  email: string;                  // User email
  roles: string[];                // User roles (STUDENT, FACULTY, HEAD_ADMIN, DEPT_ADMIN, etc.)
  displayName: string;            // User display name
  tokenVersion: number;           // Token version for rotation tracking

  // Optional fields
  collegeId?: string;             // College ID (for college-scoped operations)
  department?: string;            // Department code (for department-scoped operations)
  year?: number;                  // Academic year (for students only)
  
  // Standard JWT claims
  iss?: string;                   // Issuer
  aud?: string;                   // Audience
  exp?: number;                   // Expiration time
  iat?: number;                   // Issued at
  nbf?: number;                   // Not before
}

/**
 * Type guard to validate JWT payload structure
 * Use this to ensure JWT has required fields before using
 */
export function isValidJWTPayload(payload: any): payload is JWTPayload {
  return (
    typeof payload.sub === 'string' &&
    typeof payload.email === 'string' &&
    Array.isArray(payload.roles) &&
    typeof payload.displayName === 'string' &&
    typeof payload.tokenVersion === 'number'
  );
}

/**
 * Extract user identity from JWT payload
 * Provides consistent way to get user ID across the service
 */
export function extractUserId(payload: JWTPayload): string {
  // Use 'sub' as primary identifier (standard JWT claim)
  return payload.sub;
}

/**
 * Extract user roles from JWT payload
 * Provides consistent way to get roles across the service
 */
export function extractRoles(payload: JWTPayload): string[] {
  return payload.roles || [];
}

/**
 * Check if user has admin role
 */
export function isAdmin(payload: JWTPayload): boolean {
  const adminRoles = ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'];
  return extractRoles(payload).some(role => adminRoles.includes(role));
}

/**
 * Check if user is head admin
 */
export function isHeadAdmin(payload: JWTPayload): boolean {
  return extractRoles(payload).includes('HEAD_ADMIN');
}

/**
 * Check if user is department admin
 */
export function isDeptAdmin(payload: JWTPayload): boolean {
  return extractRoles(payload).includes('DEPT_ADMIN');
}

/**
 * Check if user is student
 */
export function isStudent(payload: JWTPayload): boolean {
  return extractRoles(payload).includes('STUDENT');
}

/**
 * Check if user is faculty
 */
export function isFaculty(payload: JWTPayload): boolean {
  return extractRoles(payload).includes('FACULTY');
}
