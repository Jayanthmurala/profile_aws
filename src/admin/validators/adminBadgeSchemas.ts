import { z } from 'zod';

// Badge definition schemas
export const createBadgeSchema = z.object({
  name: z.string().min(1, 'Badge name is required').max(100, 'Badge name too long'),
  description: z.string().min(1, 'Description is required').max(500, 'Description too long'),
  icon: z.string().optional(),
  color: z.string().optional(),
  category: z.string().max(50).optional(),
  criteria: z.string().max(1000).optional(),
  rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']).default('COMMON'),
  points: z.number().int().min(1).max(1000).optional().default(10),
  isActive: z.boolean().optional().default(true)
});

export const updateBadgeSchema = createBadgeSchema.partial();

export const awardBadgeSchema = z.object({
  badgeDefinitionId: z.string().cuid('Invalid badge ID'),
  userId: z.string().cuid('Invalid user ID'),
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long'),
  projectId: z.string().cuid().optional(),
  eventId: z.string().cuid().optional(),
  awardedByName: z.string().optional()
});

export const revokeBadgeSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long')
});

export const bulkBadgeOperationSchema = z.object({
  action: z.enum(['AWARD', 'REVOKE']),
  awards: z.array(z.object({
    userId: z.string().cuid(),
    badgeDefinitionId: z.string().cuid(),
    reason: z.string().min(1).max(500),
    projectId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional()
  })).min(1, 'At least one award required').max(500, 'Maximum 500 awards per operation'),
  preview: z.boolean().optional().default(false)
});

export const badgePolicySchema = z.object({
  collegeId: z.string().cuid(),
  departmentId: z.string().optional(),
  eventCreationRequired: z.number().int().min(0).max(50).default(8),
  categoryDiversityMin: z.number().int().min(0).max(20).default(4),
  isActive: z.boolean().default(true)
});

// Query schemas
export const badgeFiltersSchema = z.object({
  categories: z.string().optional().transform(val => val ? val.split(',') : undefined),
  rarity: z.string().optional().transform(val => val ? val.split(',') : undefined),
  isActive: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  collegeSpecific: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  awardedBy: z.string().optional(),
  awardedAfter: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  awardedBefore: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined)
});

export const leaderboardQuerySchema = z.object({
  limit: z.string().optional().transform(val => parseInt(val || '50')).pipe(z.number().int().min(1).max(100))
});

// Route parameter schemas
export const badgeParamsSchema = z.object({
  badgeId: z.string().cuid('Invalid badge ID')
});

export const badgeAwardParamsSchema = z.object({
  awardId: z.string().cuid('Invalid award ID')
});

// Response schemas
export const badgeDefinitionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  category: z.string().nullable(),
  criteria: z.string().nullable(),
  rarity: z.string(),
  points: z.number(),
  isActive: z.boolean(),
  collegeId: z.string().nullable(),
  createdAt: z.date(),
  createdBy: z.string().nullable(),
  awardCount: z.number().optional(),
  recentAwards: z.array(z.object({
    id: z.string(),
    studentId: z.string(),
    awardedAt: z.date()
  })).optional()
});

export const badgeAwardResponseSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  badgeId: z.string(),
  awardedBy: z.string(),
  awardedByName: z.string().nullable(),
  reason: z.string(),
  awardedAt: z.date(),
  projectId: z.string().nullable(),
  eventId: z.string().nullable(),
  badge: badgeDefinitionResponseSchema
});

export const badgeStatisticsResponseSchema = z.object({
  overview: z.object({
    totalBadges: z.number(),
    collegeBadges: z.number(),
    totalAwards: z.number(),
    recentAwards: z.number()
  }),
  topBadges: z.array(z.object({
    badgeId: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    category: z.string().nullable(),
    awardCount: z.number()
  })),
  categoryStats: z.array(z.object({
    category: z.string().nullable(),
    count: z.number()
  }))
});

export const badgeLeaderboardResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    rank: z.number(),
    userId: z.string(),
    displayName: z.string(),
    department: z.string().nullable(),
    year: z.number().nullable(),
    badgeCount: z.number(),
    categories: z.array(z.string()),
    totalPoints: z.number()
  }))
});

export const badgesListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(badgeDefinitionResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional()
});

export const badgePolicyResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    collegeId: z.string(),
    departmentId: z.string().nullable(),
    eventCreationRequired: z.number(),
    categoryDiversityMin: z.number(),
    isActive: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date()
  }).nullable()
});
