import { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

/**
 * System-level authentication for inter-service communication
 * Used for endpoints that should only be called by other services
 */

export interface SystemRequest extends FastifyRequest {
  system: {
    serviceId: string;
    timestamp: number;
  };
}

/**
 * Middleware to authenticate system-level requests
 * Uses a shared secret or service token for authentication
 */
export async function requireSystemAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers["authorization"];
    const systemToken = request.headers["x-system-token"] as string;
    const serviceId = request.headers["x-service-id"] as string;

    // Check for system token in headers
    if (!systemToken || !serviceId) {
      return reply.code(401).send({ 
        success: false,
        message: "Missing system authentication headers" 
      });
    }

    // Validate system token (in production, use proper JWT or shared secret)
    const expectedToken = generateSystemToken(serviceId);
    if (systemToken !== expectedToken) {
      return reply.code(401).send({ 
        success: false,
        message: "Invalid system token" 
      });
    }

    // Validate service ID is authorized
    const authorizedServices = ['auth-service', 'network-service', 'placement-service'];
    if (!authorizedServices.includes(serviceId)) {
      return reply.code(403).send({ 
        success: false,
        message: "Service not authorized for this endpoint" 
      });
    }

    // Attach system context to request
    (request as SystemRequest).system = {
      serviceId,
      timestamp: Date.now()
    };

    // Log system access for audit
    request.log.info({
      serviceId,
      endpoint: request.url,
      method: request.method,
      ip: request.ip
    }, 'System service access');

  } catch (error) {
    request.log.error({ error }, 'System auth middleware error');
    return reply.code(401).send({ 
      success: false,
      message: "System authentication failed" 
    });
  }
}

/**
 * Alternative: Bearer token authentication for system calls
 * More secure than shared secret, uses JWT validation
 */
export async function requireSystemBearerAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers["authorization"];
    
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ 
        success: false,
        message: "Missing system authorization token" 
      });
    }

    const token = authHeader.slice("Bearer ".length);
    
    // Validate system JWT token
    // In production, this should validate against a system JWKS endpoint
    const systemPayload = await validateSystemToken(token);
    
    if (!systemPayload || !systemPayload.serviceId) {
      return reply.code(401).send({ 
        success: false,
        message: "Invalid system token" 
      });
    }

    // Validate service permissions
    const servicePermissions = getSystemServicePermissions(systemPayload.serviceId);
    if (!servicePermissions.canCreateProfiles) {
      return reply.code(403).send({ 
        success: false,
        message: "Service not authorized to create profiles" 
      });
    }

    // Attach system context
    (request as SystemRequest).system = {
      serviceId: systemPayload.serviceId,
      timestamp: Date.now()
    };

    // Audit log
    request.log.info({
      serviceId: systemPayload.serviceId,
      endpoint: request.url,
      method: request.method
    }, 'System service authenticated');

  } catch (error) {
    request.log.error({ error }, 'System bearer auth error');
    return reply.code(401).send({ 
      success: false,
      message: "System authentication failed" 
    });
  }
}

/**
 * Generate system token (simplified - use proper crypto in production)
 */
function generateSystemToken(serviceId: string): string {
  const secret = env.SYSTEM_SECRET || 'default-system-secret';
  const timestamp = Math.floor(Date.now() / (1000 * 60 * 5)); // 5-minute window
  
  // Simple HMAC-like token (use proper HMAC in production)
  const payload = `${serviceId}:${timestamp}`;
  const hash = Buffer.from(`${payload}:${secret}`).toString('base64');
  
  return hash;
}

/**
 * Validate system JWT token (placeholder - implement proper JWT validation)
 */
async function validateSystemToken(token: string): Promise<{ serviceId: string } | null> {
  try {
    // In production, validate JWT token with proper signature verification
    // For now, return mock validation
    
    // Decode token (this is a placeholder - use proper JWT library)
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    if (decoded.iss === 'nexus-system' && decoded.serviceId) {
      return { serviceId: decoded.serviceId };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get service permissions based on service ID
 */
function getSystemServicePermissions(serviceId: string) {
  const permissions = {
    'auth-service': {
      canCreateProfiles: true,
      canUpdateProfiles: true,
      canDeleteProfiles: true,
      canAccessUserData: true
    },
    'network-service': {
      canCreateProfiles: false,
      canUpdateProfiles: false,
      canDeleteProfiles: false,
      canAccessUserData: true
    },
    'placement-service': {
      canCreateProfiles: false,
      canUpdateProfiles: true,
      canDeleteProfiles: false,
      canAccessUserData: true
    }
  };

  return permissions[serviceId as keyof typeof permissions] || {
    canCreateProfiles: false,
    canUpdateProfiles: false,
    canDeleteProfiles: false,
    canAccessUserData: false
  };
}

/**
 * Middleware to check specific system permissions
 */
export function requireSystemPermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const systemRequest = request as SystemRequest;
    
    if (!systemRequest.system) {
      return reply.code(401).send({ 
        success: false,
        message: "System authentication required" 
      });
    }

    const permissions = getSystemServicePermissions(systemRequest.system.serviceId);
    
    if (!permissions[permission as keyof typeof permissions]) {
      return reply.code(403).send({ 
        success: false,
        message: `Service ${systemRequest.system.serviceId} not authorized for ${permission}` 
      });
    }
  };
}
