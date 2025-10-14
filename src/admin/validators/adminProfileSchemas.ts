import { z } from 'zod';

// Profile management schemas
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(1000).optional(),
  skills: z.array(z.string()).max(50).optional(),
  expertise: z.array(z.string()).max(20).optional(),
  linkedIn: z.string().url().optional().or(z.literal("")),
  github: z.string().url().optional().or(z.literal("")),
  twitter: z.string().url().optional().or(z.literal("")),
  resumeUrl: z.string().url().optional().or(z.literal("")),
  contactInfo: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
  alternateEmail: z.string().email().optional(),
  year: z.number().int().min(1).max(6).optional(),
  department: z.string().max(100).optional()
});

export const bulkProfileOperationSchema = z.object({
  action: z.enum(['UPDATE', 'APPROVE', 'REJECT', 'REQUIRE_COMPLETION']),
  profiles: z.array(z.object({
    userId: z.string().cuid(),
    data: updateProfileSchema.optional(),
    reason: z.string().optional()
  })).min(1).max(500),
  preview: z.boolean().optional().default(false)
});

export const profileRequirementsSchema = z.object({
  collegeId: z.string().cuid(),
  requireBio: z.boolean().default(false),
  requireSkills: z.boolean().default(false),
  minSkillCount: z.number().int().min(0).max(50).default(0),
  requireProjects: z.boolean().default(false),
  minProjectCount: z.number().int().min(0).max(20).default(0),
  requireExperience: z.boolean().default(false),
  requireResume: z.boolean().default(false),
  requireSocialLinks: z.boolean().default(false),
  enforceForNetwork: z.boolean().default(true),
  enforceForEvents: z.boolean().default(true),
  enforceForProjects: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

export const profileFiltersSchema = z.object({
  departments: z.string().optional().transform(val => val ? val.split(',') : undefined),
  years: z.string().optional().transform(val => val ? val.split(',').map(Number) : undefined),
  skills: z.string().optional().transform(val => val ? val.split(',') : undefined),
  badges: z.string().optional().transform(val => val ? val.split(',') : undefined),
  completionStatus: z.enum(['COMPLETE', 'INCOMPLETE', 'PENDING_APPROVAL']).optional(),
  hasProjects: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  hasPublications: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  search: z.string().optional(),
  createdAfter: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  createdBefore: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined)
});

export const paginationSchema = z.object({
  page: z.string().optional().transform(val => parseInt(val || '1')).pipe(z.number().int().min(1)),
  limit: z.string().optional().transform(val => parseInt(val || '50')).pipe(z.number().int().min(1).max(100)),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

export const profileParamsSchema = z.object({
  userId: z.string().cuid('Invalid user ID')
});

// Response schemas
export const profileResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  skills: z.array(z.string()),
  expertise: z.array(z.string()),
  linkedIn: z.string().nullable(),
  github: z.string().nullable(),
  twitter: z.string().nullable(),
  resumeUrl: z.string().nullable(),
  contactInfo: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  alternateEmail: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  user: z.object({
    displayName: z.string(),
    email: z.string(),
    department: z.string().nullable(),
    year: z.number().nullable()
  }).nullable(),
  completionStatus: z.object({
    percentage: z.number(),
    missing: z.array(z.string())
  }).optional()
});

export const profilesListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(profileResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional()
});

export const bulkOperationResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    totalProcessed: z.number(),
    successful: z.number(),
    failed: z.number(),
    errors: z.array(z.object({
      index: z.number(),
      error: z.string(),
      data: z.any().optional()
    })),
    preview: z.boolean().optional()
  })
});

export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
