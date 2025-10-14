import { z } from 'zod';

// Common validation patterns
const cuidSchema = z.string().cuid('Invalid CUID format');
const emailSchema = z.string().email('Invalid email format');
const urlSchema = z.string().url('Invalid URL format').optional().or(z.literal(''));
const hexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid hex color format').optional();

// Badge rarity enum
export const BadgeRaritySchema = z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'], {
  errorMap: () => ({ message: 'Rarity must be one of: COMMON, UNCOMMON, RARE, EPIC, LEGENDARY' })
});

// Badge category validation
export const BadgeCategorySchema = z.string()
  .min(1, 'Category cannot be empty')
  .max(50, 'Category must be 50 characters or less')
  .regex(/^[a-zA-Z0-9\s_-]+$/, 'Category can only contain letters, numbers, spaces, underscores, and hyphens')
  .optional();

// Badge definition validation schema
export const BadgeDefinitionRequestSchema = z.object({
  name: z.string()
    .min(1, 'Badge name is required')
    .max(100, 'Badge name must be 100 characters or less')
    .regex(/^[a-zA-Z0-9\s\-_()]+$/, 'Badge name can only contain letters, numbers, spaces, hyphens, underscores, and parentheses')
    .transform(name => name.trim()),
  
  description: z.string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description must be 500 characters or less')
    .transform(desc => desc.trim()),
  
  icon: z.string()
    .max(100, 'Icon identifier must be 100 characters or less')
    .regex(/^[a-zA-Z0-9\-_]+$/, 'Icon identifier can only contain letters, numbers, hyphens, and underscores')
    .optional(),
  
  color: hexColorSchema,
  
  category: BadgeCategorySchema,
  
  criteria: z.string()
    .max(1000, 'Criteria must be 1000 characters or less')
    .transform(criteria => criteria?.trim())
    .optional(),
  
  rarity: BadgeRaritySchema,
  
  points: z.number()
    .int('Points must be an integer')
    .min(1, 'Points must be at least 1')
    .max(1000, 'Points cannot exceed 1000')
    .optional()
    .default(10),
  
  isActive: z.boolean()
    .optional()
    .default(true)
});

// Badge award validation schema
export const BadgeAwardRequestSchema = z.object({
  badgeDefinitionId: cuidSchema,
  
  userId: cuidSchema,
  
  reason: z.string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason must be 500 characters or less')
    .transform(reason => reason.trim()),
  
  projectId: cuidSchema.optional(),
  
  eventId: cuidSchema.optional(),
  
  awardedByName: z.string()
    .min(1, 'Awarded by name cannot be empty')
    .max(100, 'Awarded by name must be 100 characters or less')
    .regex(/^[a-zA-Z\s\-'.]+$/, 'Awarded by name can only contain letters, spaces, hyphens, apostrophes, and periods')
    .transform(name => name.trim())
    .optional()
});

// Bulk badge operation validation schema
export const BulkBadgeOperationSchema = z.object({
  action: z.enum(['AWARD', 'REVOKE'], {
    errorMap: () => ({ message: 'Action must be either AWARD or REVOKE' })
  }),
  
  awards: z.array(z.object({
    userId: cuidSchema,
    badgeDefinitionId: cuidSchema,
    reason: z.string()
      .min(5, 'Reason must be at least 5 characters')
      .max(500, 'Reason must be 500 characters or less')
      .transform(reason => reason.trim()),
    projectId: cuidSchema.optional(),
    eventId: cuidSchema.optional()
  }))
    .min(1, 'At least one badge operation is required')
    .max(100, 'Maximum 100 badge operations allowed per bulk operation'),
  
  preview: z.boolean()
    .optional()
    .default(false)
});

// Badge revocation validation schema
export const BadgeRevocationSchema = z.object({
  badgeAwardId: cuidSchema,
  
  reason: z.string()
    .min(5, 'Revocation reason must be at least 5 characters')
    .max(500, 'Revocation reason must be 500 characters or less')
    .transform(reason => reason.trim())
});

// Badge filters validation schema
export const BadgeFiltersSchema = z.object({
  name: z.string()
    .max(100, 'Name filter must be 100 characters or less')
    .optional(),
  
  category: BadgeCategorySchema,
  
  rarity: BadgeRaritySchema.optional(),
  
  isActive: z.boolean().optional(),
  
  createdBy: cuidSchema.optional(),
  
  collegeId: cuidSchema.optional()
});

// Pagination validation schema
export const PaginationSchema = z.object({
  page: z.number()
    .int('Page must be an integer')
    .min(1, 'Page must be at least 1')
    .optional()
    .default(1),
  
  limit: z.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional()
    .default(20),
  
  sortBy: z.enum(['name', 'createdAt', 'points', 'rarity'], {
    errorMap: () => ({ message: 'Sort by must be one of: name, createdAt, points, rarity' })
  }).optional().default('createdAt'),
  
  sortOrder: z.enum(['asc', 'desc'], {
    errorMap: () => ({ message: 'Sort order must be either asc or desc' })
  }).optional().default('desc')
});

// Badge policy configuration validation schema
export const BadgePolicyConfigSchema = z.object({
  collegeId: cuidSchema,
  
  maxDailyAwards: z.number()
    .int('Max daily awards must be an integer')
    .min(1, 'Max daily awards must be at least 1')
    .max(1000, 'Max daily awards cannot exceed 1000')
    .optional()
    .default(50),
  
  maxBulkOperationSize: z.number()
    .int('Max bulk operation size must be an integer')
    .min(1, 'Max bulk operation size must be at least 1')
    .max(100, 'Max bulk operation size cannot exceed 100')
    .optional()
    .default(50),
  
  requireApprovalForHighRarity: z.boolean()
    .optional()
    .default(true),
  
  highRarityThreshold: BadgeRaritySchema
    .optional()
    .default('RARE'),
  
  allowSelfAward: z.boolean()
    .optional()
    .default(false),
  
  requireProjectForAward: z.boolean()
    .optional()
    .default(false),
  
  autoRevokeOnGraduation: z.boolean()
    .optional()
    .default(false)
});

// Admin context validation schema
export const AdminContextSchema = z.object({
  id: cuidSchema,
  
  email: emailSchema,
  
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .transform(name => name.trim()),
  
  roles: z.array(z.enum(['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'FACULTY'], {
    errorMap: () => ({ message: 'Invalid role specified' })
  }))
    .min(1, 'At least one role is required'),
  
  collegeId: cuidSchema,
  
  department: z.string()
    .max(100, 'Department must be 100 characters or less')
    .optional(),
  
  ipAddress: z.string()
    .ip('Invalid IP address format')
    .optional(),
  
  userAgent: z.string()
    .max(500, 'User agent must be 500 characters or less')
    .optional()
});

// Leaderboard query validation schema
export const LeaderboardQuerySchema = z.object({
  limit: z.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional()
    .default(50),
  
  collegeId: cuidSchema.optional(),
  
  department: z.string()
    .max(100, 'Department must be 100 characters or less')
    .optional(),
  
  timeframe: z.enum(['all', 'year', 'semester', 'month'], {
    errorMap: () => ({ message: 'Timeframe must be one of: all, year, semester, month' })
  }).optional().default('all')
});

// Export type definitions for TypeScript
export type BadgeDefinitionRequest = z.infer<typeof BadgeDefinitionRequestSchema>;
export type BadgeAwardRequest = z.infer<typeof BadgeAwardRequestSchema>;
export type BulkBadgeOperation = z.infer<typeof BulkBadgeOperationSchema>;
export type BadgeRevocation = z.infer<typeof BadgeRevocationSchema>;
export type BadgeFilters = z.infer<typeof BadgeFiltersSchema>;
export type PaginationParams = z.infer<typeof PaginationSchema>;
export type BadgePolicyConfig = z.infer<typeof BadgePolicyConfigSchema>;
export type AdminContext = z.infer<typeof AdminContextSchema>;
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

// Validation helper functions
export class BadgeValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'BadgeValidationError';
  }
}

export function validateBadgeDefinition(data: unknown): BadgeDefinitionRequest {
  try {
    return BadgeDefinitionRequestSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw new BadgeValidationError(
        firstError.message,
        firstError.path.join('.'),
        'INVALID_BADGE_DEFINITION'
      );
    }
    throw error;
  }
}

export function validateBadgeAward(data: unknown): BadgeAwardRequest {
  try {
    return BadgeAwardRequestSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw new BadgeValidationError(
        firstError.message,
        firstError.path.join('.'),
        'INVALID_BADGE_AWARD'
      );
    }
    throw error;
  }
}

export function validateBulkOperation(data: unknown): BulkBadgeOperation {
  try {
    return BulkBadgeOperationSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw new BadgeValidationError(
        firstError.message,
        firstError.path.join('.'),
        'INVALID_BULK_OPERATION'
      );
    }
    throw error;
  }
}

export function validateAdminContext(data: unknown): AdminContext {
  try {
    return AdminContextSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw new BadgeValidationError(
        firstError.message,
        firstError.path.join('.'),
        'INVALID_ADMIN_CONTEXT'
      );
    }
    throw error;
  }
}
