/**
 * Structured error classes for AdminBadgeService
 * Provides consistent error handling with proper HTTP status codes and error types
 */

export enum BadgeErrorCode {
  // Validation Errors (400)
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_BADGE_DEFINITION = 'INVALID_BADGE_DEFINITION',
  INVALID_BADGE_AWARD = 'INVALID_BADGE_AWARD',
  INVALID_BULK_OPERATION = 'INVALID_BULK_OPERATION',
  
  // Authentication/Authorization Errors (401/403)
  UNAUTHORIZED = 'UNAUTHORIZED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_ADMIN_CONTEXT = 'INVALID_ADMIN_CONTEXT',
  
  // Resource Not Found Errors (404)
  BADGE_NOT_FOUND = 'BADGE_NOT_FOUND',
  BADGE_AWARD_NOT_FOUND = 'BADGE_AWARD_NOT_FOUND',
  STUDENT_NOT_FOUND = 'STUDENT_NOT_FOUND',
  COLLEGE_NOT_FOUND = 'COLLEGE_NOT_FOUND',
  
  // Conflict Errors (409)
  DUPLICATE_BADGE_NAME = 'DUPLICATE_BADGE_NAME',
  DUPLICATE_BADGE_AWARD = 'DUPLICATE_BADGE_AWARD',
  BADGE_ALREADY_REVOKED = 'BADGE_ALREADY_REVOKED',
  
  // Business Logic Errors (422)
  BADGE_INACTIVE = 'BADGE_INACTIVE',
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  BULK_LIMIT_EXCEEDED = 'BULK_LIMIT_EXCEEDED',
  CANNOT_REVOKE_BADGE = 'CANNOT_REVOKE_BADGE',
  CROSS_COLLEGE_ACCESS_DENIED = 'CROSS_COLLEGE_ACCESS_DENIED',
  HIGH_RARITY_APPROVAL_REQUIRED = 'HIGH_RARITY_APPROVAL_REQUIRED',
  
  // Server Errors (500)
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  AUDIT_LOG_FAILED = 'AUDIT_LOG_FAILED'
}

export class BadgeServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: BadgeErrorCode;
  public readonly field?: string;
  public readonly details?: Record<string, any>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: BadgeErrorCode,
    statusCode: number = 400,
    field?: string,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'BadgeServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.field = field;
    this.details = details;
    this.timestamp = new Date();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BadgeServiceError);
    }
  }

  toJSON() {
    return {
      error: {
        name: this.name,
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        field: this.field,
        details: this.details,
        timestamp: this.timestamp.toISOString()
      }
    };
  }
}

// Validation Error Classes
export class BadgeValidationError extends BadgeServiceError {
  constructor(message: string, field?: string, details?: Record<string, any>) {
    super(message, BadgeErrorCode.INVALID_INPUT, 400, field, details);
    this.name = 'BadgeValidationError';
  }
}

export class BadgeDefinitionValidationError extends BadgeServiceError {
  constructor(message: string, field?: string, details?: Record<string, any>) {
    super(message, BadgeErrorCode.INVALID_BADGE_DEFINITION, 400, field, details);
    this.name = 'BadgeDefinitionValidationError';
  }
}

export class BadgeAwardValidationError extends BadgeServiceError {
  constructor(message: string, field?: string, details?: Record<string, any>) {
    super(message, BadgeErrorCode.INVALID_BADGE_AWARD, 400, field, details);
    this.name = 'BadgeAwardValidationError';
  }
}

// Authorization Error Classes
export class BadgeUnauthorizedError extends BadgeServiceError {
  constructor(message: string = 'Unauthorized access', details?: Record<string, any>) {
    super(message, BadgeErrorCode.UNAUTHORIZED, 401, undefined, details);
    this.name = 'BadgeUnauthorizedError';
  }
}

export class BadgeInsufficientPermissionsError extends BadgeServiceError {
  constructor(message: string = 'Insufficient permissions', details?: Record<string, any>) {
    super(message, BadgeErrorCode.INSUFFICIENT_PERMISSIONS, 403, undefined, details);
    this.name = 'BadgeInsufficientPermissionsError';
  }
}

// Not Found Error Classes
export class BadgeNotFoundError extends BadgeServiceError {
  constructor(badgeId: string, details?: Record<string, any>) {
    super(`Badge with ID ${badgeId} not found`, BadgeErrorCode.BADGE_NOT_FOUND, 404, 'badgeId', {
      badgeId,
      ...details
    });
    this.name = 'BadgeNotFoundError';
  }
}

export class BadgeAwardNotFoundError extends BadgeServiceError {
  constructor(awardId: string, details?: Record<string, any>) {
    super(`Badge award with ID ${awardId} not found`, BadgeErrorCode.BADGE_AWARD_NOT_FOUND, 404, 'awardId', {
      awardId,
      ...details
    });
    this.name = 'BadgeAwardNotFoundError';
  }
}

export class StudentNotFoundError extends BadgeServiceError {
  constructor(userId: string, details?: Record<string, any>) {
    super(`Student with ID ${userId} not found or access denied`, BadgeErrorCode.STUDENT_NOT_FOUND, 404, 'userId', {
      userId,
      ...details
    });
    this.name = 'StudentNotFoundError';
  }
}

// Conflict Error Classes
export class DuplicateBadgeNameError extends BadgeServiceError {
  constructor(badgeName: string, collegeId: string, details?: Record<string, any>) {
    super(`Badge "${badgeName}" already exists in this college`, BadgeErrorCode.DUPLICATE_BADGE_NAME, 409, 'name', {
      badgeName,
      collegeId,
      ...details
    });
    this.name = 'DuplicateBadgeNameError';
  }
}

export class DuplicateBadgeAwardError extends BadgeServiceError {
  constructor(userId: string, badgeId: string, details?: Record<string, any>) {
    super('Student already has this badge', BadgeErrorCode.DUPLICATE_BADGE_AWARD, 409, 'badgeId', {
      userId,
      badgeId,
      ...details
    });
    this.name = 'DuplicateBadgeAwardError';
  }
}

// Business Logic Error Classes
export class BadgeInactiveError extends BadgeServiceError {
  constructor(badgeId: string, details?: Record<string, any>) {
    super('Cannot award inactive badge', BadgeErrorCode.BADGE_INACTIVE, 422, 'badgeId', {
      badgeId,
      ...details
    });
    this.name = 'BadgeInactiveError';
  }
}

export class DailyLimitExceededError extends BadgeServiceError {
  constructor(adminId: string, currentCount: number, maxLimit: number, details?: Record<string, any>) {
    super(`Daily badge award limit exceeded (${currentCount}/${maxLimit})`, BadgeErrorCode.DAILY_LIMIT_EXCEEDED, 422, undefined, {
      adminId,
      currentCount,
      maxLimit,
      ...details
    });
    this.name = 'DailyLimitExceededError';
  }
}

export class BulkLimitExceededError extends BadgeServiceError {
  constructor(requestedCount: number, maxLimit: number, details?: Record<string, any>) {
    super(`Bulk operation limit exceeded (${requestedCount}/${maxLimit})`, BadgeErrorCode.BULK_LIMIT_EXCEEDED, 422, undefined, {
      requestedCount,
      maxLimit,
      ...details
    });
    this.name = 'BulkLimitExceededError';
  }
}

export class CannotRevokeBadgeError extends BadgeServiceError {
  constructor(reason: string, details?: Record<string, any>) {
    super(`Cannot revoke badge: ${reason}`, BadgeErrorCode.CANNOT_REVOKE_BADGE, 422, undefined, details);
    this.name = 'CannotRevokeBadgeError';
  }
}

export class CrossCollegeAccessDeniedError extends BadgeServiceError {
  constructor(resourceType: string, resourceId: string, details?: Record<string, any>) {
    super(`Cannot access ${resourceType} from different college`, BadgeErrorCode.CROSS_COLLEGE_ACCESS_DENIED, 403, undefined, {
      resourceType,
      resourceId,
      ...details
    });
    this.name = 'CrossCollegeAccessDeniedError';
  }
}

// Server Error Classes
export class BadgeDatabaseError extends BadgeServiceError {
  constructor(operation: string, originalError?: Error, details?: Record<string, any>) {
    super(`Database error during ${operation}`, BadgeErrorCode.DATABASE_ERROR, 500, undefined, {
      operation,
      originalError: originalError?.message,
      ...details
    });
    this.name = 'BadgeDatabaseError';
  }
}

export class BadgeExternalServiceError extends BadgeServiceError {
  constructor(service: string, operation: string, originalError?: Error, details?: Record<string, any>) {
    super(`External service error: ${service} - ${operation}`, BadgeErrorCode.EXTERNAL_SERVICE_ERROR, 500, undefined, {
      service,
      operation,
      originalError: originalError?.message,
      ...details
    });
    this.name = 'BadgeExternalServiceError';
  }
}

export class BadgeTransactionError extends BadgeServiceError {
  constructor(operation: string, originalError?: Error, details?: Record<string, any>) {
    super(`Transaction failed during ${operation}`, BadgeErrorCode.TRANSACTION_FAILED, 500, undefined, {
      operation,
      originalError: originalError?.message,
      ...details
    });
    this.name = 'BadgeTransactionError';
  }
}

// Error Factory Functions
export class BadgeErrorFactory {
  static validationError(message: string, field?: string, details?: Record<string, any>): BadgeValidationError {
    return new BadgeValidationError(message, field, details);
  }

  static notFound(type: 'badge' | 'award' | 'student', id: string, details?: Record<string, any>): BadgeServiceError {
    switch (type) {
      case 'badge':
        return new BadgeNotFoundError(id, details);
      case 'award':
        return new BadgeAwardNotFoundError(id, details);
      case 'student':
        return new StudentNotFoundError(id, details);
      default:
        return new BadgeServiceError(`${type} not found`, BadgeErrorCode.BADGE_NOT_FOUND, 404, undefined, details);
    }
  }

  static conflict(type: 'duplicate_badge' | 'duplicate_award', details: Record<string, any>): BadgeServiceError {
    switch (type) {
      case 'duplicate_badge':
        return new DuplicateBadgeNameError(details.badgeName, details.collegeId, details);
      case 'duplicate_award':
        return new DuplicateBadgeAwardError(details.userId, details.badgeId, details);
      default:
        return new BadgeServiceError('Conflict error', BadgeErrorCode.DUPLICATE_BADGE_AWARD, 409, undefined, details);
    }
  }

  static businessLogic(type: 'inactive_badge' | 'daily_limit' | 'bulk_limit' | 'cannot_revoke' | 'rate_limit', details: Record<string, any>): BadgeServiceError {
    switch (type) {
      case 'inactive_badge':
        return new BadgeInactiveError(details.badgeId, details);
      case 'daily_limit':
        return new DailyLimitExceededError(details.adminId, details.currentCount, details.maxLimit, details);
      case 'bulk_limit':
        return new BulkLimitExceededError(details.requestedCount, details.maxLimit, details);
      case 'cannot_revoke':
        return new CannotRevokeBadgeError(details.reason, details);
      case 'rate_limit':
        return new BadgeServiceError('Rate limit exceeded', BadgeErrorCode.DAILY_LIMIT_EXCEEDED, 429, undefined, details);
      default:
        return new BadgeServiceError('Business logic error', BadgeErrorCode.BADGE_INACTIVE, 422, undefined, details);
    }
  }

  static serverError(type: 'database' | 'external_service' | 'transaction', operation: string, originalError?: Error, details?: Record<string, any>): BadgeServiceError {
    switch (type) {
      case 'database':
        return new BadgeDatabaseError(operation, originalError, details);
      case 'external_service':
        return new BadgeExternalServiceError(details?.service || 'unknown', operation, originalError, details);
      case 'transaction':
        return new BadgeTransactionError(operation, originalError, details);
      default:
        return new BadgeServiceError('Server error', BadgeErrorCode.DATABASE_ERROR, 500, undefined, details);
    }
  }
}

// Error Handler Utility
export class BadgeErrorHandler {
  static handleZodError(error: any, context: string): BadgeValidationError {
    if (error.errors && Array.isArray(error.errors)) {
      const firstError = error.errors[0];
      return new BadgeValidationError(
        firstError.message,
        firstError.path?.join('.'),
        {
          context,
          allErrors: error.errors,
          zodError: true
        }
      );
    }
    return new BadgeValidationError(`Validation failed: ${context}`, undefined, { context });
  }

  static handlePrismaError(error: any, operation: string): BadgeServiceError {
    // Handle Prisma-specific errors
    if (error.code === 'P2002') {
      // Unique constraint violation
      const target = error.meta?.target;
      if (target?.includes('name')) {
        return BadgeErrorFactory.conflict('duplicate_badge', {
          badgeName: 'unknown',
          collegeId: 'unknown',
          prismaError: error
        });
      }
      if (target?.includes('badgeId_studentId')) {
        return BadgeErrorFactory.conflict('duplicate_award', {
          userId: 'unknown',
          badgeId: 'unknown',
          prismaError: error
        });
      }
    }

    if (error.code === 'P2025') {
      // Record not found
      return BadgeErrorFactory.notFound('badge', 'unknown', { prismaError: error });
    }

    // Generic database error
    return BadgeErrorFactory.serverError('database', operation, error);
  }

  static handleAuthServiceError(error: any, operation: string): BadgeServiceError {
    if (error.response?.status === 401) {
      return new BadgeUnauthorizedError('Authentication failed with auth service');
    }
    if (error.response?.status === 403) {
      return new BadgeInsufficientPermissionsError('Access denied by auth service');
    }
    if (error.response?.status === 404) {
      return BadgeErrorFactory.notFound('student', 'unknown', { authServiceError: error });
    }

    return BadgeErrorFactory.serverError('external_service', operation, error, { service: 'auth-service' });
  }
}
