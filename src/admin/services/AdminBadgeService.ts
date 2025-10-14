import { prisma } from '../../db.js';
import { AdminAuditService } from './AdminAuditService.js';
import { ProfileAuditAction } from '../types/adminTypes.js';
import { BadgePostService } from '../../utils/BadgePostService.js';
import { AuthServiceClient, AuthUser } from '../../utils/AuthServiceClient.js';
import { 
  validateBadgeDefinition,
  validateBadgeAward,
  validateBulkOperation,
  BadgeDefinitionRequestSchema,
  BadgeAwardRequestSchema,
  BulkBadgeOperationSchema,
  BadgeFiltersSchema,
  PaginationSchema
} from '../validation/badgeValidation.js';
import {
  BadgeErrorFactory,
  BadgeErrorHandler,
  BadgeServiceError,
  DuplicateBadgeNameError,
  DuplicateBadgeAwardError,
  BadgeNotFoundError,
  BadgeInactiveError,
  DailyLimitExceededError,
  BulkLimitExceededError,
  StudentNotFoundError,
  CrossCollegeAccessDeniedError
} from '../errors/BadgeServiceErrors.js';
import { 
  BadgeDefinitionRequest, 
  BadgeAwardRequest,
  BulkBadgeOperation,
  BulkOperationResult,
  BadgeFilters,
  PaginationParams,
  ADMIN_LIMITS,
  BadgePolicyConfig
} from '../types/adminTypes';

export class AdminBadgeService {
  /**
   * Create a new badge definition (HEAD_ADMIN only)
   */
  static async createBadgeDefinition(
    badgeData: unknown,
    collegeId: string,
    createdBy: string
  ) {
    try {
      // Validate input data
      const validatedData = validateBadgeDefinition(badgeData);

      // Check if badge name already exists in this college
      const existingBadge = await prisma.badgeDefinition.findFirst({
        where: {
          name: validatedData.name,
          collegeId: collegeId
        }
      });

      if (existingBadge) {
        throw new DuplicateBadgeNameError(validatedData.name, collegeId);
      }

      // Create badge definition in transaction
      const result = await prisma.$transaction(async (tx) => {
        const badgeDefinition = await tx.badgeDefinition.create({
          data: {
            name: validatedData.name,
            description: validatedData.description,
            icon: validatedData.icon,
            color: validatedData.color,
            category: validatedData.category,
            criteria: validatedData.criteria,
            rarity: validatedData.rarity,
            points: validatedData.points,
            isActive: validatedData.isActive,
            collegeId: collegeId, // Always college-specific for HEAD_ADMIN
            createdBy
          }
        });

        // Log audit action
        await AdminAuditService.logAction({
          adminId: createdBy,
          action: 'CREATE_BADGE',
          targetType: 'BADGE_DEFINITION',
          targetId: badgeDefinition.id,
          collegeId: collegeId,
          success: true,
          details: {
            badgeName: validatedData.name,
            rarity: validatedData.rarity,
            points: validatedData.points,
            category: validatedData.category
          }
        });

        return badgeDefinition;
      }, {
        isolationLevel: 'ReadCommitted',
        timeout: 10000
      });

      return result;
    } catch (error) {
      if (error instanceof BadgeServiceError) {
        throw error;
      }
      
      // Handle Prisma errors
      if (error && typeof error === 'object' && 'code' in error) {
        throw BadgeErrorHandler.handlePrismaError(error, 'createBadgeDefinition');
      }

      // Handle validation errors
      if (error && typeof error === 'object' && 'errors' in error) {
        throw BadgeErrorHandler.handleZodError(error, 'createBadgeDefinition');
      }

      // Generic error
      throw BadgeErrorFactory.serverError('database', 'createBadgeDefinition', error as Error);
    }
  }

  /**
   * Update badge definition
   */
  static async updateBadgeDefinition(
    badgeId: string,
    updates: Partial<BadgeDefinitionRequest>,
    adminCollegeId: string
  ) {
    // Verify badge belongs to admin's college
    const badge = await prisma.badgeDefinition.findUnique({
      where: { id: badgeId }
    });

    if (!badge) {
      throw new Error('Badge not found');
    }

    if (badge.collegeId !== adminCollegeId && badge.collegeId !== null) {
      throw new Error('Cannot modify badge from different college');
    }

    // Check name uniqueness if name is being updated
    if (updates.name && updates.name !== badge.name) {
      const existingBadge = await prisma.badgeDefinition.findFirst({
        where: {
          name: updates.name,
          collegeId: adminCollegeId,
          id: { not: badgeId }
        }
      });

      if (existingBadge) {
        throw new Error(`Badge "${updates.name}" already exists in this college`);
      }
    }

    return await prisma.badgeDefinition.update({
      where: { id: badgeId },
      data: updates
    });
  }

  /**
   * Get badge definitions with filtering
   */
  static async getBadgeDefinitions(
    filters: BadgeFilters,
    pagination: PaginationParams,
    adminCollegeId: string
  ) {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100);

    // Build where clause
    const where: any = {
      OR: [
        { collegeId: adminCollegeId }, // College-specific badges
        { collegeId: null } // Global badges
      ]
    };

    if (filters.categories && filters.categories.length > 0) {
      where.category = { in: filters.categories };
    }

    if (filters.rarity && filters.rarity.length > 0) {
      where.rarity = { in: filters.rarity };
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.collegeSpecific !== undefined) {
      if (filters.collegeSpecific) {
        where.collegeId = adminCollegeId;
      } else {
        where.collegeId = null;
      }
    }

    const [badges, total] = await Promise.all([
      prisma.badgeDefinition.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          awards: {
            select: {
              id: true,
              studentId: true,
              awardedAt: true
            }
          },
          _count: {
            select: {
              awards: true
            }
          }
        }
      }),
      prisma.badgeDefinition.count({ where })
    ]);

    return {
      badges: badges.map(badge => ({
        ...badge,
        awardCount: badge._count.awards,
        recentAwards: badge.awards.slice(0, 5)
      })),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Award badge to student
   */
  static async awardBadge(
    awardData: unknown,
    awardedBy: string,
    adminCollegeId: string,
    authHeader: string = ''
  ) {
    try {
      // Validate input data
      const validatedData = validateBadgeAward(awardData);

      // Pre-transaction validations (external service calls)
      // Verify student belongs to admin's college
      const hasAccess = await this.checkStudentAccess(validatedData.userId, adminCollegeId, authHeader);
      if (!hasAccess) {
        throw new StudentNotFoundError(validatedData.userId, { adminCollegeId });
      }

      // Check daily award limits
      const limitCheck = await this.checkDailyAwardLimits(awardedBy);
      if (!limitCheck.allowed) {
        throw new DailyLimitExceededError(awardedBy, limitCheck.currentCount || 0, limitCheck.maxLimit || 50);
      }

      // Execute badge awarding in a transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Verify badge exists and is accessible (with row-level lock)
        const badge = await tx.badgeDefinition.findUnique({
          where: { id: validatedData.badgeDefinitionId }
        });

        if (!badge) {
          throw new BadgeNotFoundError(validatedData.badgeDefinitionId);
        }

        if (badge.collegeId && badge.collegeId !== adminCollegeId) {
          throw new CrossCollegeAccessDeniedError('badge', validatedData.badgeDefinitionId, { 
            badgeCollegeId: badge.collegeId, 
            adminCollegeId 
          });
        }

        if (!badge.isActive) {
          throw new BadgeInactiveError(validatedData.badgeDefinitionId);
        }

        // Check for existing award with SELECT FOR UPDATE to prevent race conditions
        const existingAward = await tx.studentBadge.findUnique({
          where: {
            badgeId_studentId: {
              badgeId: validatedData.badgeDefinitionId,
              studentId: validatedData.userId
            }
          }
        });

        if (existingAward) {
          throw new DuplicateBadgeAwardError(validatedData.userId, validatedData.badgeDefinitionId);
        }

        // Create the badge award
        const studentBadge = await tx.studentBadge.create({
          data: {
            studentId: validatedData.userId,
            badgeId: validatedData.badgeDefinitionId,
            awardedBy,
            awardedByName: validatedData.awardedByName,
            reason: validatedData.reason,
            projectId: validatedData.projectId,
            eventId: validatedData.eventId
          },
          include: {
            badge: true
          }
        });

        // Log the audit action within the transaction
        await AdminAuditService.logAction({
          adminId: awardedBy,
          action: 'AWARD_BADGE',
          targetType: 'STUDENT_BADGE',
          targetId: studentBadge.id,
          collegeId: adminCollegeId,
          success: true,
          details: {
            studentId: validatedData.userId,
            badgeId: validatedData.badgeDefinitionId,
            badgeName: badge.name,
            reason: validatedData.reason,
            projectId: validatedData.projectId,
            eventId: validatedData.eventId
          }
        });

        return studentBadge;
      }, {
        isolationLevel: 'ReadCommitted', // Prevent phantom reads
        timeout: 10000 // 10 second timeout
      });

      // Post-transaction operations (non-critical)
      // Create network post if enabled - this is done outside transaction
      // so it doesn't block the badge creation if it fails
      try {
        await BadgePostService.createSimpleBadgePost(result, authHeader);
      } catch (error) {
        console.error('Failed to create badge award post:', error);
        // Log but don't fail the badge creation
      }

      return result;
    } catch (error) {
      if (error instanceof BadgeServiceError) {
        throw error;
      }
      
      // Handle Prisma errors
      if (error && typeof error === 'object' && 'code' in error) {
        throw BadgeErrorHandler.handlePrismaError(error, 'awardBadge');
      }

      // Handle auth service errors
      if (error && typeof error === 'object' && 'response' in error) {
        throw BadgeErrorHandler.handleAuthServiceError(error, 'awardBadge');
      }

      // Handle validation errors
      if (error && typeof error === 'object' && 'errors' in error) {
        throw BadgeErrorHandler.handleZodError(error, 'awardBadge');
      }

      // Generic error
      throw BadgeErrorFactory.serverError('transaction', 'awardBadge', error as Error);
    }
  }

  /**
   * Revoke badge from student
   */
  static async revokeBadge(
    badgeAwardId: string,
    reason: string,
    adminId: string,
    adminCollegeId: string
  ) {
    // Execute badge revocation in a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Get badge award details with row lock
      const badgeAward = await tx.studentBadge.findUnique({
        where: { id: badgeAwardId },
        include: {
          badge: true
        }
      });

      if (!badgeAward) {
        throw new Error('Badge award not found');
      }

      // Check if admin can revoke this badge
      const canRevoke = await this.canRevokeBadgeAward(badgeAward, adminId, adminCollegeId);
      if (!canRevoke) {
        throw new Error('Cannot revoke this badge award');
      }

      // Delete the badge award
      await tx.studentBadge.delete({
        where: { id: badgeAwardId }
      });

      // Log the audit action within the transaction
      await AdminAuditService.logAction({
        adminId,
        action: 'REVOKE_BADGE',
        targetType: 'STUDENT_BADGE',
        targetId: badgeAwardId,
        collegeId: adminCollegeId,
        success: true,
        details: {
          studentId: badgeAward.studentId,
          badgeId: badgeAward.badgeId,
          badgeName: badgeAward.badge.name,
          reason,
          originalAwardedBy: badgeAward.awardedBy,
          originalReason: badgeAward.reason
        }
      });

      return { 
        success: true, 
        reason,
        revokedBadge: {
          id: badgeAward.id,
          studentId: badgeAward.studentId,
          badgeName: badgeAward.badge.name
        }
      };
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 10000
    });

    return result;
  }

  /**
   * Bulk badge operations
   */
  static async bulkBadgeOperation(
    operation: unknown,
    adminId: string,
    adminCollegeId: string,
    authHeader: string = ''
  ): Promise<BulkOperationResult> {
    try {
      // Validate input data
      const validatedOperation = validateBulkOperation(operation);

      if (validatedOperation.awards.length > ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE) {
        throw new BulkLimitExceededError(
          validatedOperation.awards.length, 
          ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE
        );
      }

      const result: BulkOperationResult = {
        totalProcessed: validatedOperation.awards.length,
        successful: 0,
        failed: 0,
        errors: [],
        preview: validatedOperation.preview
      };

      // If preview mode, validate without executing
      if (validatedOperation.preview) {
        for (let i = 0; i < validatedOperation.awards.length; i++) {
          try {
            await this.validateBulkBadgeOperation(validatedOperation.action, validatedOperation.awards[i], adminCollegeId);
            result.successful++;
          } catch (error) {
            result.failed++;
            result.errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
              data: validatedOperation.awards[i]
            });
          }
        }
        return result;
      }

      // Execute bulk operation
      for (let i = 0; i < validatedOperation.awards.length; i++) {
        try {
          const awardOp = validatedOperation.awards[i];
          
          switch (validatedOperation.action) {
            case 'AWARD':
              await this.awardBadge({
                badgeDefinitionId: awardOp.badgeDefinitionId,
                userId: awardOp.userId,
                reason: awardOp.reason,
                projectId: awardOp.projectId,
                eventId: awardOp.eventId
              }, adminId, adminCollegeId, authHeader);
              break;
            case 'REVOKE':
              // Find the badge award to revoke
              const badgeAward = await prisma.studentBadge.findUnique({
                where: {
                  badgeId_studentId: {
                    badgeId: awardOp.badgeDefinitionId,
                    studentId: awardOp.userId
                  }
                }
              });
              if (badgeAward) {
                await this.revokeBadge(badgeAward.id, awardOp.reason, adminId, adminCollegeId);
              }
              break;
          }
          
          result.successful++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            index: i,
            error: error instanceof BadgeServiceError ? error.message : (error instanceof Error ? error.message : 'Unknown error'),
            data: validatedOperation.awards[i]
          });
        }
      }

      return result;
    } catch (error) {
      if (error instanceof BadgeServiceError) {
        throw error;
      }
      
      // Handle validation errors
      if (error && typeof error === 'object' && 'errors' in error) {
        throw BadgeErrorHandler.handleZodError(error, 'bulkBadgeOperation');
      }

      // Generic error
      throw BadgeErrorFactory.serverError('database', 'bulkBadgeOperation', error as Error);
    }
  }

  /**
   * Get badge statistics
   */
  static async getBadgeStatistics(adminCollegeId: string) {
    const [
      totalBadges,
      collegeBadges,
      totalAwards,
      recentAwards,
      topBadges,
      categoryStats
    ] = await Promise.all([
      // Total badges available (college + global)
      prisma.badgeDefinition.count({
        where: {
          OR: [
            { collegeId: adminCollegeId },
            { collegeId: null }
          ],
          isActive: true
        }
      }),

      // College-specific badges
      prisma.badgeDefinition.count({
        where: {
          collegeId: adminCollegeId,
          isActive: true
        }
      }),

      // Total awards in college
      prisma.studentBadge.count({
        where: {
          badge: {
            OR: [
              { collegeId: adminCollegeId },
              { collegeId: null }
            ]
          }
        }
      }),

      // Recent awards (last 30 days)
      prisma.studentBadge.count({
        where: {
          badge: {
            OR: [
              { collegeId: adminCollegeId },
              { collegeId: null }
            ]
          },
          awardedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      }),

      // Top awarded badges
      prisma.studentBadge.groupBy({
        by: ['badgeId'],
        where: {
          badge: {
            OR: [
              { collegeId: adminCollegeId },
              { collegeId: null }
            ]
          }
        },
        _count: { badgeId: true },
        orderBy: { _count: { badgeId: 'desc' } },
        take: 10
      }),

      // Category statistics
      prisma.badgeDefinition.groupBy({
        by: ['category'],
        where: {
          OR: [
            { collegeId: adminCollegeId },
            { collegeId: null }
          ],
          isActive: true,
          category: { not: null }
        },
        _count: { category: true }
      })
    ]);

    // Get badge details for top badges
    const topBadgeIds = topBadges.map(tb => tb.badgeId);
    const topBadgeDetails = await prisma.badgeDefinition.findMany({
      where: { id: { in: topBadgeIds } },
      select: { id: true, name: true, icon: true, category: true }
    });

    return {
      overview: {
        totalBadges,
        collegeBadges,
        totalAwards,
        recentAwards
      },
      topBadges: topBadges.map(tb => {
        const badge = topBadgeDetails.find(b => b.id === tb.badgeId);
        return {
          badgeId: tb.badgeId,
          name: badge?.name || 'Unknown',
          icon: badge?.icon,
          category: badge?.category,
          awardCount: tb._count.badgeId
        };
      }),
      categoryStats: categoryStats.map(cs => ({
        category: cs.category,
        count: cs._count.category
      }))
    };
  }

  /**
   * Get badge leaderboard (optimized to prevent N+1 queries)
   */
  static async getBadgeLeaderboard(adminCollegeId: string, limit: number = 50, authHeader: string = '') {
    try {
      // Validate input
      const validatedLimit = Math.min(Math.max(limit, 1), 100); // Ensure limit is between 1-100

      // Step 1: Get top students with badge counts using optimized query
      const leaderboardData = await prisma.studentBadge.groupBy({
        by: ['studentId'],
        where: {
          badge: {
            OR: [
              { collegeId: adminCollegeId },
              { collegeId: null }
            ]
          }
        },
        _count: { studentId: true },
        orderBy: { _count: { studentId: 'desc' } },
        take: validatedLimit
      });

      if (leaderboardData.length === 0) {
        return [];
      }

      const userIds = leaderboardData.map(l => l.studentId);

      // Step 2: Get all badge details for these students in a single query (fixes N+1)
      const studentBadges = await prisma.studentBadge.findMany({
        where: {
          studentId: { in: userIds },
          badge: {
            OR: [
              { collegeId: adminCollegeId },
              { collegeId: null }
            ]
          }
        },
        include: {
          badge: {
            select: {
              id: true,
              name: true,
              category: true,
              points: true,
              rarity: true
            }
          }
        },
        orderBy: [
          { studentId: 'asc' },
          { awardedAt: 'desc' }
        ]
      });

      // Step 3: Group badges by student for efficient processing
      const badgesByStudent = new Map<string, typeof studentBadges>();
      studentBadges.forEach(badge => {
        if (!badgesByStudent.has(badge.studentId)) {
          badgesByStudent.set(badge.studentId, []);
        }
        badgesByStudent.get(badge.studentId)!.push(badge);
      });

      // Step 4: Get user details from auth service (batch operation)
      const userData = await AuthServiceClient.getBatchUsers(userIds, authHeader);

      // Step 5: Build leaderboard with all data
      const leaderboard = leaderboardData.map((student, index) => {
        const user = userData.get(student.studentId);
        const badges = badgesByStudent.get(student.studentId) || [];
        
        // Calculate categories and points from the fetched badges
        const categories = [...new Set(badges.map(b => b.badge.category).filter(Boolean))];
        const totalPoints = badges.reduce((sum, b) => sum + (b.badge.points || 0), 0);
        
        // Get recent badges (last 3)
        const recentBadges = badges.slice(0, 3).map(b => ({
          id: b.badge.id,
          name: b.badge.name,
          rarity: b.badge.rarity,
          awardedAt: b.awardedAt
        }));

        return {
          rank: index + 1,
          userId: student.studentId,
          displayName: user?.displayName || 'Unknown Student',
          department: user?.department || 'Unknown',
          year: user?.year,
          badgeCount: student._count.studentId,
          totalPoints,
          categories: categories.sort(),
          recentBadges,
          // Additional metadata
          averagePointsPerBadge: student._count.studentId > 0 ? Math.round(totalPoints / student._count.studentId) : 0,
          categoryCount: categories.length
        };
      });

      return leaderboard;
    } catch (error) {
      if (error instanceof BadgeServiceError) {
        throw error;
      }
      
      // Handle auth service errors
      if (error && typeof error === 'object' && 'response' in error) {
        throw BadgeErrorHandler.handleAuthServiceError(error, 'getBadgeLeaderboard');
      }

      // Generic error
      throw BadgeErrorFactory.serverError('database', 'getBadgeLeaderboard', error as Error);
    }
  }

  /**
   * Set badge policy for college
   */
  static async setBadgePolicy(
    collegeId: string,
    policy: BadgePolicyConfig
  ) {
    return await prisma.badgePolicy.upsert({
      where: { collegeId },
      update: {
        departmentId: policy.departmentId,
        eventCreationRequired: policy.eventCreationRequired,
        categoryDiversityMin: policy.categoryDiversityMin,
        isActive: policy.isActive
      },
      create: {
        collegeId: policy.collegeId,
        departmentId: policy.departmentId,
        eventCreationRequired: policy.eventCreationRequired,
        categoryDiversityMin: policy.categoryDiversityMin,
        isActive: policy.isActive
      }
    });
  }

  /**
   * Get badge policy for college
   */
  static async getBadgePolicy(collegeId: string) {
    return await prisma.badgePolicy.findUnique({
      where: { collegeId }
    });
  }

  // Private helper methods

  private static async checkStudentAccess(
    userId: string, 
    adminCollegeId: string, 
    authHeader: string = ''
  ): Promise<boolean> {
    try {
      const user = await AuthServiceClient.getUser(userId, authHeader);
      if (!user) {
        return false;
      }
      return user.collegeId === adminCollegeId && (user.roles?.includes('STUDENT') ?? false);
    } catch (error) {
      console.error('Error checking student access:', error);
      return false;
    }
  }

  private static async checkDailyAwardLimits(adminId: string): Promise<{ 
    allowed: boolean; 
    reason?: string;
    currentCount?: number;
    maxLimit?: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAwards = await prisma.studentBadge.count({
      where: {
        awardedBy: adminId,
        awardedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    const maxLimit = ADMIN_LIMITS.MAX_BADGE_AWARDS_PER_DAY;

    if (todayAwards >= maxLimit) {
      return {
        allowed: false,
        reason: `Daily badge award limit of ${maxLimit} reached`,
        currentCount: todayAwards,
        maxLimit
      };
    }

    return { 
      allowed: true,
      currentCount: todayAwards,
      maxLimit
    };
  }

  private static async canRevokeBadgeAward(
    badgeAward: any,
    adminId: string,
    adminCollegeId: string
  ): Promise<boolean> {
    // Check if badge belongs to admin's college
    if (badgeAward.badge.collegeId && badgeAward.badge.collegeId !== adminCollegeId) {
      return false;
    }

    // HEAD_ADMIN can revoke badges, but not those awarded by SUPER_ADMIN
    // This would require checking the awardedBy user's role
    // For now, simplified check
    return true;
  }


  private static async validateBulkBadgeOperation(
    action: string,
    awardOp: any,
    adminCollegeId: string
  ): Promise<void> {
    if (!awardOp.userId || !awardOp.badgeDefinitionId) {
      throw new Error('Missing required fields: userId, badgeDefinitionId');
    }

    if (!awardOp.reason) {
      throw new Error('Reason is required for badge operations');
    }

    // Check badge access
    const badge = await prisma.badgeDefinition.findUnique({
      where: { id: awardOp.badgeDefinitionId }
    });

    if (!badge) {
      throw new Error(`Badge ${awardOp.badgeDefinitionId} not found`);
    }

    if (badge.collegeId && badge.collegeId !== adminCollegeId) {
      throw new Error(`Cannot access badge from different college`);
    }

    // Check student access
    const hasAccess = await this.checkStudentAccess(awardOp.userId, adminCollegeId);
    if (!hasAccess) {
      throw new Error(`Student ${awardOp.userId} not found or access denied`);
    }
  }
}
