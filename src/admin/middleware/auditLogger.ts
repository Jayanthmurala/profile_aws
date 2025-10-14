import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from './adminAuth';
import { ProfileAuditAction } from '../types/adminTypes';

/**
 * Middleware to automatically log admin actions
 */
export function auditLogger(action: ProfileAuditAction, targetType: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const adminRequest = request as AdminRequest;
    
    if (!adminRequest.admin) {
      return;
    }

    // Store admin context for later logging
    (request as any).auditContext = {
      action,
      targetType,
      admin: adminRequest.admin
    };
  };
}

/**
 * Manual audit logging for custom scenarios
 */
export async function logAdminAction(
  request: FastifyRequest,
  action: ProfileAuditAction,
  targetType: string,
  targetId?: string,
  details?: Record<string, any>,
  success: boolean = true,
  errorMessage?: string
) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return;
  }

  try {
    // Import AdminAuditService dynamically to avoid circular dependency
    const { AdminAuditService } = await import('../services/AdminAuditService');
    
    await AdminAuditService.logAction({
      adminId: adminRequest.admin.id,
      action,
      targetType,
      targetId,
      details,
      ipAddress: adminRequest.admin.ipAddress,
      userAgent: adminRequest.admin.userAgent,
      collegeId: adminRequest.admin.collegeId,
      success,
      errorMessage
    });
  } catch (error) {
    request.log.error({ error }, 'Failed to manually log admin action');
  }
}

/**
 * Extract target ID from request or response
 */
function extractTargetId(request: FastifyRequest, responseData: any): string | undefined {
  // Try to get ID from URL params first
  const params = request.params as any;
  if (params?.id) {
    return params.id;
  }
  if (params?.userId) {
    return params.userId;
  }
  if (params?.badgeId) {
    return params.badgeId;
  }
  if (params?.projectId) {
    return params.projectId;
  }

  // Try to get ID from response data
  if (responseData?.data?.id) {
    return responseData.data.id;
  }
  if (responseData?.id) {
    return responseData.id;
  }

  return undefined;
}

/**
 * Extract action details from request and response
 */
function extractActionDetails(
  request: FastifyRequest, 
  responseData: any, 
  action: ProfileAuditAction
): Record<string, any> {
  const details: Record<string, any> = {
    method: request.method,
    url: request.url,
    action
  };

  // Add request body for create/update operations
  if ([
    'CREATE_PROFILE', 'UPDATE_PROFILE', 'CREATE_BADGE', 'UPDATE_BADGE', 
    'AWARD_BADGE', 'CREATE_PROJECT', 'UPDATE_PROJECT', 'CREATE_PUBLICATION',
    'UPDATE_PUBLICATION', 'BULK_OPERATION'
  ].includes(action)) {
    if (request.body) {
      // Sanitize sensitive data
      const sanitizedBody = { ...request.body as any };
      delete sanitizedBody.password;
      details.requestData = sanitizedBody;
    }
  }

  // Add query parameters for list/search operations
  if (request.query && Object.keys(request.query).length > 0) {
    details.queryParams = request.query;
  }

  // Add response summary for bulk operations
  if (action === 'BULK_OPERATION' && responseData?.data) {
    const { totalProcessed, successful, failed } = responseData.data;
    details.bulkResult = { totalProcessed, successful, failed };
  }

  // Add badge-specific details
  if (action === 'AWARD_BADGE' && request.body) {
    const body = request.body as any;
    details.badgeAward = {
      badgeDefinitionId: body.badgeDefinitionId,
      reason: body.reason,
      projectId: body.projectId,
      eventId: body.eventId
    };
  }

  return details;
}

/**
 * Log profile moderation action
 */
export async function logModerationAction(
  request: FastifyRequest,
  action: 'APPROVE_CONTENT' | 'REJECT_CONTENT',
  contentType: string,
  contentId: string,
  reason?: string
) {
  await logAdminAction(
    request,
    action,
    contentType,
    contentId,
    {
      contentType,
      reason,
      moderationAction: action
    }
  );
}

/**
 * Log badge management action
 */
export async function logBadgeAction(
  request: FastifyRequest,
  action: 'CREATE_BADGE' | 'UPDATE_BADGE' | 'DELETE_BADGE' | 'AWARD_BADGE' | 'REVOKE_BADGE',
  badgeId: string,
  additionalDetails?: Record<string, any>
) {
  await logAdminAction(
    request,
    action,
    'BADGE',
    badgeId,
    {
      badgeAction: action,
      ...additionalDetails
    }
  );
}

/**
 * Log profile requirement changes
 */
export async function logRequirementChange(
  request: FastifyRequest,
  collegeId: string,
  changes: Record<string, any>
) {
  await logAdminAction(
    request,
    'UPDATE_REQUIREMENTS',
    'PROFILE_REQUIREMENTS',
    collegeId,
    {
      requirementChanges: changes,
      collegeId
    }
  );
}

/**
 * Log bulk operation
 */
export async function logBulkOperation(
  request: FastifyRequest,
  operationType: string,
  itemCount: number,
  successCount: number,
  failureCount: number
) {
  await logAdminAction(
    request,
    'BULK_OPERATION',
    operationType,
    undefined,
    {
      operationType,
      totalItems: itemCount,
      successful: successCount,
      failed: failureCount,
      successRate: itemCount > 0 ? (successCount / itemCount) * 100 : 0
    }
  );
}

/**
 * Log data export action
 */
export async function logDataExport(
  request: FastifyRequest,
  exportType: string,
  recordCount: number,
  format: string = 'CSV'
) {
  await logAdminAction(
    request,
    'EXPORT_DATA',
    'DATA_EXPORT',
    undefined,
    {
      exportType,
      recordCount,
      format,
      timestamp: new Date().toISOString()
    }
  );
}

/**
 * Log report generation
 */
export async function logReportGeneration(
  request: FastifyRequest,
  reportType: string,
  parameters: Record<string, any>
) {
  await logAdminAction(
    request,
    'GENERATE_REPORT',
    'REPORT',
    undefined,
    {
      reportType,
      parameters,
      timestamp: new Date().toISOString()
    }
  );
}
