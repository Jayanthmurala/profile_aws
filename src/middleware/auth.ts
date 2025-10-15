import { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../utils/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      sub: string;
      id: string;
      email: string;
      roles: string[];
      displayName?: string;
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
    
    (request as AuthenticatedRequest).user = {
      sub: String(payload.sub),
      id: String(payload.sub),
      email: payload.email || "",
      roles: payload.roles || [],
      displayName: (payload.displayName as string) || (payload as any).name || "",
    };
    
    console.log('[Auth] User authenticated successfully:', {
      sub: payload.sub,
      roles: payload.roles,
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
