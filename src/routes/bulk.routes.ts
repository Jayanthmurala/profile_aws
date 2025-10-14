import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, DatabaseOptimizer } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AuthServiceClient } from "../utils/AuthServiceClient.js";
import { CacheInvalidator } from "../middleware/caching.js";
import { MetricsLogger } from "../utils/logger.js";

/**
 * Bulk Operations Routes for 10M+ Users Performance
 * Handles large-scale operations efficiently
 */

export default async function bulkRoutes(app: FastifyInstance) {

  // Bulk badge award endpoint (Admin only)
  app.post("/v1/bulk/badges/award", {
    preHandler: [requireAuth, requireRole(['HEAD_ADMIN', 'DEPT_ADMIN'])],
    schema: {
      tags: ["bulk"],
      body: z.object({
        badgeId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).min(1).max(1000), // Limit to 1000 per batch
        awardedBy: z.string().optional(),
        reason: z.string().max(500).optional()
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { badgeId, userIds, awardedBy, reason } = req.body as {
      badgeId: string;
      userIds: string[];
      awardedBy?: string;
      reason?: string;
    };
    const adminUserId = req.user!.sub;

    try {
      // Get admin info for validation
      const adminInfo = await AuthServiceClient.getUser(adminUserId, req.headers.authorization || '');
      if (!adminInfo?.collegeId) {
        return reply.code(403).send({
          success: false,
          message: 'Admin college information required'
        });
      }

      // Validate badge exists and admin has access
      const badge = await prisma.badgeDefinition.findUnique({
        where: { id: badgeId },
        select: { id: true, name: true, collegeId: true, isActive: true }
      });

      if (!badge) {
        return reply.code(404).send({
          success: false,
          message: 'Badge not found'
        });
      }

      if (!badge.isActive) {
        return reply.code(400).send({
          success: false,
          message: 'Badge is not active'
        });
      }

      // Check if admin has access to this badge
      if (badge.collegeId !== adminInfo.collegeId && !adminInfo.roles?.includes('HEAD_ADMIN')) {
        return reply.code(403).send({
          success: false,
          message: 'Insufficient permissions for this badge'
        });
      }

      // Check which users already have this badge
      const existingBadges = await prisma.studentBadge.findMany({
        where: {
          badgeId,
          studentId: { in: userIds }
        },
        select: { studentId: true }
      });

      const existingUserIds = new Set(existingBadges.map(b => b.studentId));
      const newUserIds = userIds.filter(id => !existingUserIds.has(id));

      if (newUserIds.length === 0) {
        return reply.send({
          success: true,
          message: 'All users already have this badge',
          results: {
            total: userIds.length,
            awarded: 0,
            skipped: userIds.length,
            errors: 0
          }
        });
      }

      // Prepare bulk insert data
      const bulkData = newUserIds.map((userId: string) => ({
        badgeId,
        studentId: userId,
        awardedBy: awardedBy || adminUserId,
        awardedAt: new Date(),
        reason: reason || `Bulk award by ${adminInfo.displayName || adminUserId}`
      }));

      // Perform bulk insert using batching
      let awarded = 0;
      let errors = 0;
      const batchSize = 100;
      const errorDetails: string[] = [];

      for (let i = 0; i < bulkData.length; i += batchSize) {
        const batch = bulkData.slice(i, i + batchSize);
        
        try {
          const result = await prisma.studentBadge.createMany({
            data: batch,
            skipDuplicates: true
          });
          
          awarded += result.count;
          
          req.log.info({
            type: 'bulk_badge_award_batch',
            badgeId,
            batchSize: batch.length,
            awarded: result.count,
            adminUserId
          }, `Bulk badge award batch completed`);
          
        } catch (error) {
          errors += batch.length;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errorDetails.push(`Batch ${Math.floor(i / batchSize) + 1}: ${errorMsg}`);
          
          req.log.error({
            type: 'bulk_badge_award_error',
            badgeId,
            batchStart: i,
            batchSize: batch.length,
            error: errorMsg,
            adminUserId
          }, `Bulk badge award batch failed`);
        }
      }

      // Invalidate relevant caches
      await CacheInvalidator.invalidateBadges();

      const duration = Date.now() - startTime;
      
      req.log.info({
        type: 'bulk_badge_award_complete',
        badgeId,
        badgeName: badge.name,
        totalRequested: userIds.length,
        awarded,
        skipped: existingUserIds.size,
        errors,
        duration,
        adminUserId
      }, `Bulk badge award completed`);

      return reply.send({
        success: true,
        message: `Bulk badge award completed`,
        results: {
          total: userIds.length,
          awarded,
          skipped: existingUserIds.size,
          errors,
          duration
        },
        badge: {
          id: badge.id,
          name: badge.name
        },
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({
        type: 'bulk_badge_award_failed',
        badgeId,
        userCount: userIds.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        adminUserId
      }, `Bulk badge award failed`);

      return reply.code(500).send({
        success: false,
        message: 'Bulk badge award failed',
        error: process.env.NODE_ENV === 'development' ? 
          (error instanceof Error ? error.message : 'Unknown error') : 
          undefined
      });
    }
  });

  // Bulk profile export (Admin only)
  app.get("/v1/bulk/profiles/export", {
    preHandler: [requireAuth, requireRole(['HEAD_ADMIN', 'DEPT_ADMIN'])],
    schema: {
      tags: ["bulk"],
      querystring: z.object({
        department: z.string().optional(),
        year: z.number().int().min(1).max(6).optional(),
        format: z.enum(['json', 'csv']).default('json'),
        includePrivate: z.boolean().default(false),
        limit: z.number().int().min(1).max(10000).default(1000)
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { department, year, format, includePrivate, limit } = req.query as any;
    const adminUserId = req.user!.sub;

    try {
      // Get admin info for validation
      const adminInfo = await AuthServiceClient.getUser(adminUserId, req.headers.authorization || '');
      if (!adminInfo?.collegeId) {
        return reply.code(403).send({
          success: false,
          message: 'Admin college information required'
        });
      }

      // Build query with pagination for large datasets
      const profiles = await prisma.profile.findMany({
        select: {
          id: true,
          userId: true,
          name: true,
          bio: includePrivate ? true : false,
          skills: true,
          expertise: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              studentBadges: true,
              personalProjects: true,
              experiences: true
            }
          }
        },
        take: limit,
        orderBy: { createdAt: 'desc' }
      });

      // Enhance with user data (in batches to avoid overwhelming auth service)
      const batchSize = 50;
      const enhancedProfiles: any[] = [];
      
      for (let i = 0; i < profiles.length; i += batchSize) {
        const batch = profiles.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(async (profile) => {
            try {
              const userData = await AuthServiceClient.getUser(profile.userId, req.headers.authorization || '');
              
              // Filter by college, department, year
              if (userData?.collegeId !== adminInfo.collegeId) return null;
              if (department && userData?.department !== department) return null;
              if (year && userData?.year !== year) return null;

              return {
                id: profile.id,
                userId: profile.userId,
                name: profile.name,
                displayName: userData?.displayName,
                email: includePrivate ? userData?.email : undefined,
                department: userData?.department,
                year: userData?.year,
                bio: profile.bio,
                skills: profile.skills,
                expertise: profile.expertise,
                badgeCount: profile._count.studentBadges,
                projectCount: profile._count.personalProjects,
                experienceCount: profile._count.experiences,
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt
              };
            } catch {
              return null;
            }
          })
        );

        // Add successful results
        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            enhancedProfiles.push(result.value);
          }
        });
      }

      const duration = Date.now() - startTime;

      req.log.info({
        type: 'bulk_profile_export',
        totalProfiles: profiles.length,
        exportedProfiles: enhancedProfiles.length,
        format,
        filters: { department, year },
        duration,
        adminUserId
      }, `Bulk profile export completed`);

      // Format response based on requested format
      if (format === 'csv') {
        // Convert to CSV format
        const csvHeaders = [
          'ID', 'User ID', 'Name', 'Display Name', 'Department', 'Year',
          'Skills Count', 'Badge Count', 'Project Count', 'Experience Count', 'Created At'
        ];
        
        const csvRows = enhancedProfiles.map(profile => [
          profile.id,
          profile.userId,
          profile.name || '',
          profile.displayName || '',
          profile.department || '',
          profile.year || '',
          profile.skills?.length || 0,
          profile.badgeCount,
          profile.projectCount,
          profile.experienceCount,
          profile.createdAt.toISOString()
        ]);

        const csvContent = [
          csvHeaders.join(','),
          ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="profiles_export_${Date.now()}.csv"`);
        
        return reply.send(csvContent);
      }

      // JSON format (default)
      return reply.send({
        success: true,
        data: enhancedProfiles,
        meta: {
          total: enhancedProfiles.length,
          format,
          filters: { department, year, includePrivate },
          exportedAt: new Date().toISOString(),
          duration
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({
        type: 'bulk_profile_export_failed',
        filters: { department, year, format },
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        adminUserId
      }, `Bulk profile export failed`);

      return reply.code(500).send({
        success: false,
        message: 'Profile export failed',
        error: process.env.NODE_ENV === 'development' ? 
          (error instanceof Error ? error.message : 'Unknown error') : 
          undefined
      });
    }
  });

  // Bulk statistics endpoint
  app.get("/v1/bulk/stats/summary", {
    preHandler: [requireAuth, requireRole(['HEAD_ADMIN', 'DEPT_ADMIN'])],
    schema: {
      tags: ["bulk"],
      querystring: z.object({
        timeframe: z.enum(['week', 'month', 'quarter', 'year']).default('month')
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { timeframe } = req.query as any;
    const adminUserId = req.user!.sub;

    try {
      // Calculate date ranges
      const now = new Date();
      const timeRanges = {
        week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        quarter: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        year: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      };
      const startDate = timeRanges[timeframe as keyof typeof timeRanges];

      // Run multiple queries in parallel for performance
      const [
        totalProfiles,
        newProfiles,
        totalBadges,
        newBadges,
        totalProjects,
        newProjects,
        profilesWithSkills,
        topSkills
      ] = await Promise.all([
        prisma.profile.count(),
        prisma.profile.count({ where: { createdAt: { gte: startDate } } }),
        prisma.studentBadge.count(),
        prisma.studentBadge.count({ where: { awardedAt: { gte: startDate } } }),
        prisma.personalProject.count(),
        prisma.personalProject.count({ where: { createdAt: { gte: startDate } } }),
        prisma.$queryRaw`SELECT COUNT(*) as count FROM "Profile" WHERE array_length(skills, 1) > 0`,
        prisma.$queryRaw`
          SELECT 
            unnest(skills) as skill,
            COUNT(*) as count
          FROM "Profile" 
          WHERE array_length(skills, 1) > 0
          GROUP BY skill
          ORDER BY count DESC
          LIMIT 10
        `
      ]);

      const duration = Date.now() - startTime;
      
      // Extract count from raw query result
      const skillsCount = Array.isArray(profilesWithSkills) && profilesWithSkills.length > 0 ? 
        Number((profilesWithSkills[0] as any).count) : 0;

      req.log.info({
        type: 'bulk_stats_summary',
        timeframe,
        duration,
        adminUserId
      }, `Bulk statistics summary generated`);

      return reply.send({
        success: true,
        stats: {
          overview: {
            totalProfiles,
            newProfiles,
            totalBadges,
            newBadges,
            totalProjects,
            newProjects,
            profilesWithSkills: skillsCount,
            completionRate: totalProfiles > 0 ? Math.round((skillsCount / totalProfiles) * 100) : 0
          },
          growth: {
            profileGrowth: totalProfiles > 0 ? Math.round((newProfiles / totalProfiles) * 100) : 0,
            badgeGrowth: totalBadges > 0 ? Math.round((newBadges / totalBadges) * 100) : 0,
            projectGrowth: totalProjects > 0 ? Math.round((newProjects / totalProjects) * 100) : 0
          },
          topSkills: topSkills
        },
        meta: {
          timeframe,
          startDate,
          endDate: now,
          duration,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({
        type: 'bulk_stats_summary_failed',
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        adminUserId
      }, `Bulk statistics summary failed`);

      return reply.code(500).send({
        success: false,
        message: 'Statistics generation failed',
        error: process.env.NODE_ENV === 'development' ? 
          (error instanceof Error ? error.message : 'Unknown error') : 
          undefined
      });
    }
  });

}
