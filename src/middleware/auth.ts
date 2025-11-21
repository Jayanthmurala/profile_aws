import { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../utils/jwt.js";
import { JWTPayload, isValidJWTPayload, extractUserId } from "../types/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      sub: string;
      id: string;
      email: string;
      roles: string[];
      displayName?: string;
      collegeId?: string;
      department?: string;
      year?: number;
    };
  }
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    sub: string;
    id: string;
    email: string;
    roles: string[];
    displayName?: string;
    collegeId?: string;
    department?: string;
    year?: number;
  };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) {
    console.log('[Auth] Missing authorization header');
    return reply.code(401).send({ message: "Missing authorization token" });
  }
  
  try {
    const token = auth.slice("Bearer ".length);
    console.log('[Auth] Attempting to verify token for request:', request.url);
    
    const payload = await verifyAccessToken(token);
    
    // Validate JWT payload structure
    if (!isValidJWTPayload(payload)) {
      console.error('[Auth] Invalid JWT payload structure:', {
        hasSub: !!payload.sub,
        hasEmail: !!payload.email,
        hasRoles: Array.isArray(payload.roles),
        hasDisplayName: !!payload.displayName,
        hasTokenVersion: typeof payload.tokenVersion === 'number'
      });
      return reply.code(401).send({ message: "Invalid token structure" });
    }
    
    // Extract user ID using centralized function
    const userId = extractUserId(payload);
    
    (request as AuthenticatedRequest).user = {
      sub: userId,
      id: userId,
      email: payload.email,
      roles: payload.roles,
      displayName: payload.displayName,
      collegeId: payload.collegeId,
      department: payload.department,
      year: payload.year,
    };
    
    console.log('[Auth] User authenticated successfully:', {
      sub: userId,
      roles: payload.roles,
      department: payload.department,
      url: request.url
    });

    // CRITICAL FIX: Return to allow request to continue
    return;
  } catch (error) {
    console.error('[Auth] Authentication failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      url: request.url
    });
    return reply.code(401).send({ message: "Invalid or expired token" });
  }
}

export function requireRole(roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    
    const user = (request as AuthenticatedRequest).user;
    const hasRole = roles.some(role => user.roles.includes(role));
    
    if (!hasRole) {
      return reply.code(403).send({ message: "Insufficient permissions" });
    }

    // CRITICAL FIX: Return to allow request to continue
    return;
  };
}
