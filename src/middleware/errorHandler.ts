import { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

/**
 * Centralized error handler for production-ready error management
 * Provides consistent error responses and proper logging
 */

interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  errorId?: string;
  details?: any;
  timestamp: string;
}

function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function maskSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
  const masked = { ...obj };
  
  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      masked[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      masked[key] = maskSensitiveData(value);
    }
  }
  
  return masked;
}

export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const errorId = generateErrorId();
  const timestamp = new Date().toISOString();

  // Log the error with context (mask sensitive data)
  request.log.error({
    errorId,
    error: {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      code: error.code,
      statusCode: error.statusCode
    },
    request: {
      method: request.method,
      url: request.url,
      headers: maskSensitiveData(request.headers),
      params: request.params,
      query: request.query,
      user: request.user ? { sub: request.user.sub, roles: request.user.roles } : undefined
    },
    timestamp
  }, 'Request error occurred');

  let response: ErrorResponse = {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    statusCode: 500,
    errorId,
    timestamp
  };

  // Handle specific error types
  if (error.validation) {
    // Fastify validation errors
    response = {
      error: 'Validation Error',
      message: 'Request validation failed',
      statusCode: 400,
      errorId,
      details: error.validation,
      timestamp
    };
  } else if (error.name === 'ZodError') {
    // Zod validation errors
    const zodError = error as unknown as ZodError;
    response = {
      error: 'Validation Error',
      message: 'Request validation failed',
      statusCode: 400,
      errorId,
      details: zodError.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code
      })),
      timestamp
    };
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma database errors
    switch (error.code) {
      case 'P2002':
        response = {
          error: 'Conflict',
          message: 'A record with this data already exists',
          statusCode: 409,
          errorId,
          timestamp
        };
        break;
      case 'P2025':
        response = {
          error: 'Not Found',
          message: 'The requested record was not found',
          statusCode: 404,
          errorId,
          timestamp
        };
        break;
      case 'P2003':
        response = {
          error: 'Bad Request',
          message: 'Invalid reference to related record',
          statusCode: 400,
          errorId,
          timestamp
        };
        break;
      default:
        response = {
          error: 'Database Error',
          message: 'A database error occurred',
          statusCode: 500,
          errorId,
          timestamp
        };
    }
  } else if (error.statusCode) {
    // HTTP errors with status codes
    response = {
      error: getErrorName(error.statusCode),
      message: error.message || getDefaultMessage(error.statusCode),
      statusCode: error.statusCode,
      errorId,
      timestamp
    };
  } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    // Network/service connection errors
    response = {
      error: 'Service Unavailable',
      message: 'External service is temporarily unavailable',
      statusCode: 503,
      errorId,
      timestamp
    };
  } else if (error.code === 'ETIMEDOUT') {
    // Timeout errors
    response = {
      error: 'Request Timeout',
      message: 'The request took too long to process',
      statusCode: 408,
      errorId,
      timestamp
    };
  }

  // Add development details if in development mode
  if (process.env.NODE_ENV === 'development') {
    response.details = {
      ...response.details,
      originalError: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      }
    };
  }

  // Send the error response
  reply.status(response.statusCode).send(response);
}

function getErrorName(statusCode: number): string {
  const errorNames: { [key: number]: string } = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return errorNames[statusCode] || 'Unknown Error';
}

function getDefaultMessage(statusCode: number): string {
  const defaultMessages: { [key: number]: string } = {
    400: 'The request was invalid or malformed',
    401: 'Authentication is required',
    403: 'You do not have permission to access this resource',
    404: 'The requested resource was not found',
    405: 'The HTTP method is not allowed for this resource',
    409: 'The request conflicts with the current state',
    422: 'The request was well-formed but contains semantic errors',
    429: 'Too many requests have been made',
    500: 'An internal server error occurred',
    502: 'Invalid response from upstream server',
    503: 'The service is temporarily unavailable',
    504: 'The upstream server did not respond in time'
  };
  return defaultMessages[statusCode] || 'An error occurred';
}

// Custom error classes for better error handling
export class ValidationError extends Error {
  statusCode = 400;
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  constructor(message: string = 'Resource already exists') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string = 'Access forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ServiceUnavailableError extends Error {
  statusCode = 503;
  constructor(message: string = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}
