import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Input Sanitization Middleware for Production Security
 * Prevents XSS, SQL Injection, and other input-based attacks
 */

interface SanitizationOptions {
  sanitizeHtml?: boolean;
  trimWhitespace?: boolean;
  maxLength?: number;
  allowedTags?: string[];
  stripScripts?: boolean;
}

// Default sanitization configuration
const DEFAULT_OPTIONS: SanitizationOptions = {
  sanitizeHtml: true,
  trimWhitespace: true,
  maxLength: 10000,
  allowedTags: [], // No HTML tags allowed by default
  stripScripts: true
};

// Dangerous patterns to detect and block
const DANGEROUS_PATTERNS = [
  // SQL Injection patterns
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
  // XSS patterns
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/i,
  /on\w+\s*=/i,
  // Path traversal
  /\.\.[\/\\]/,
  // Command injection
  /[;&|`$(){}]/
];

// Fields that should never contain HTML
const PLAIN_TEXT_FIELDS = [
  'email', 'phone', 'phoneNumber', 'userId', 'id', 'password',
  'token', 'key', 'secret', 'year', 'department'
];

// Fields that can contain limited HTML (for rich text)
const RICH_TEXT_FIELDS = [
  'bio', 'description', 'content', 'notes'
];

/**
 * Simple HTML sanitizer - strips all HTML tags
 */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Simple HTML sanitizer - allows only specified tags
 */
function sanitizeHtml(input: string, allowedTags: string[] = []): string {
  if (allowedTags.length === 0) {
    return stripHtml(input);
  }
  
  // Create regex pattern for allowed tags
  const allowedPattern = allowedTags.map(tag => `</?${tag}[^>]*>`).join('|');
  const regex = new RegExp(`<(?!/?(?:${allowedTags.join('|')})[^>]*>)[^>]*>`, 'gi');
  
  return input.replace(regex, '');
}

/**
 * Sanitize a single string value
 */
function sanitizeString(
  value: string, 
  fieldName: string, 
  options: SanitizationOptions = DEFAULT_OPTIONS
): string {
  if (typeof value !== 'string') return value;

  let sanitized = value;

  // Trim whitespace
  if (options.trimWhitespace) {
    sanitized = sanitized.trim();
  }

  // Check length limits
  if (options.maxLength && sanitized.length > options.maxLength) {
    throw new Error(`Field '${fieldName}' exceeds maximum length of ${options.maxLength} characters`);
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      throw new Error(`Field '${fieldName}' contains potentially dangerous content`);
    }
  }

  // Handle HTML sanitization based on field type
  if (PLAIN_TEXT_FIELDS.some(field => fieldName.toLowerCase().includes(field))) {
    // Strip all HTML for plain text fields
    sanitized = stripHtml(sanitized);
  } else if (RICH_TEXT_FIELDS.some(field => fieldName.toLowerCase().includes(field))) {
    // Allow limited HTML for rich text fields
    sanitized = sanitizeHtml(sanitized, ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li']);
  } else if (options.sanitizeHtml) {
    // Default: strip all HTML
    sanitized = options.allowedTags?.length ? 
      sanitizeHtml(sanitized, options.allowedTags) : 
      stripHtml(sanitized);
  }

  return sanitized;
}

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj: any, path: string = ''): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeString(obj, path);
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => 
      sanitizeObject(item, `${path}[${index}]`)
    );
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;
      sanitized[key] = sanitizeObject(value, fieldPath);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Validate file upload inputs
 */
function validateFileInput(filename: string, mimeType: string): void {
  // Check filename for dangerous patterns
  if (/[<>:"|?*\\\/]/.test(filename)) {
    throw new Error('Filename contains invalid characters');
  }

  // Check for executable file extensions
  const dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
    '.php', '.asp', '.jsp', '.sh', '.ps1'
  ];
  
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  if (dangerousExtensions.includes(ext)) {
    throw new Error('File type not allowed');
  }

  // Validate MIME type
  const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'application/json'
  ];

  if (!allowedMimeTypes.includes(mimeType)) {
    throw new Error('MIME type not allowed');
  }
}

/**
 * Main sanitization middleware
 */
export function createInputSanitizer(options: SanitizationOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Sanitize request body
      if (request.body && typeof request.body === 'object') {
        request.body = sanitizeObject(request.body, 'body');
      }

      // Sanitize query parameters
      if (request.query && typeof request.query === 'object') {
        request.query = sanitizeObject(request.query, 'query');
      }

      // Sanitize URL parameters
      if (request.params && typeof request.params === 'object') {
        request.params = sanitizeObject(request.params, 'params');
      }

      // Log sanitization for monitoring
      request.log.debug({
        url: request.url,
        method: request.method,
        sanitized: true
      }, 'Input sanitization completed');

      // CRITICAL FIX: Return to allow request to continue
      return;

    } catch (error) {
      request.log.warn({
        error: error instanceof Error ? error.message : 'Unknown error',
        url: request.url,
        method: request.method,
        userAgent: request.headers['user-agent']
      }, 'Input sanitization failed - potentially malicious input detected');

      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Invalid input detected',
        code: 'INVALID_INPUT'
      });
    }
  };
}

/**
 * Specific sanitizers for different endpoint types
 */
export const profileInputSanitizer = createInputSanitizer({
  sanitizeHtml: true,
  trimWhitespace: true,
  maxLength: 5000,
  allowedTags: ['b', 'i', 'em', 'strong'] // Allow basic formatting in bio
});

export const searchInputSanitizer = createInputSanitizer({
  sanitizeHtml: true,
  trimWhitespace: true,
  maxLength: 200,
  allowedTags: [] // No HTML in search queries
});

export const adminInputSanitizer = createInputSanitizer({
  sanitizeHtml: true,
  trimWhitespace: true,
  maxLength: 10000,
  allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li']
});

/**
 * Content Security Policy headers
 */
export function addSecurityHeaders(request: FastifyRequest, reply: FastifyReply) {
  // Content Security Policy
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'"
  ].join('; '));

  // Other security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // HTTPS enforcement (in production)
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // CRITICAL FIX: Return to allow request to continue
  return;
}

// Export validation functions
export { validateFileInput, sanitizeString, sanitizeObject };
