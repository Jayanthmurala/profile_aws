import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAdmin, requireDeptAdmin } from '../middleware/adminAuth';
import { DeptAdminController } from '../controllers/DeptAdminController';
import {
  updateProfileSchema,
  bulkProfileOperationSchema,
  profileFiltersSchema,
  paginationSchema,
  profileParamsSchema,
  profileResponseSchema,
  profilesListResponseSchema,
  bulkOperationResponseSchema,
  errorResponseSchema
} from '../validators/adminProfileSchemas';
import {
  awardBadgeSchema,
  badgeFiltersSchema,
  badgeParamsSchema,
  badgeLeaderboardResponseSchema,
  badgeStatisticsResponseSchema
} from '../validators/adminBadgeSchemas';

/**
 * DEPT_ADMIN routes for profile service
 * IMPORTANT: These routes are department-scoped and do not affect other roles
 */
export async function deptAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply admin authentication to all routes - SAME PATTERN AS HEAD_ADMIN
  f.addHook('preHandler', requireAdmin);
  f.addHook('preHandler', requireDeptAdmin);

  // Dashboard - Department scoped
  f.get('/v1/admin/dept/dashboard', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get DEPT_ADMIN dashboard data',
      description: 'Retrieve department-specific dashboard with profile analytics, badge statistics, and completion rates',
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getDashboard);

  // Profile Management - Department scoped only
  f.get('/v1/admin/dept/profiles', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get profiles in department',
      description: 'Retrieve all profiles in the admin\'s department with filtering options',
      querystring: profileFiltersSchema.merge(paginationSchema),
      response: {
        200: profilesListResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getProfiles);

  f.get('/v1/admin/dept/profiles/:userId', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get single profile in department',
      description: 'Retrieve detailed profile information for users in admin\'s department',
      params: profileParamsSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: profileResponseSchema } },
        404: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, DeptAdminController.getProfile);

  f.put('/v1/admin/dept/profiles/:userId', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Update profile in department',
      description: 'Update profile information for users in admin\'s department',
      params: profileParamsSchema,
      body: updateProfileSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: profileResponseSchema } },
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, DeptAdminController.updateProfile);

  f.post('/v1/admin/dept/profiles/bulk', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Bulk profile operations in department',
      description: 'Perform bulk operations on profiles within admin\'s department',
      body: bulkProfileOperationSchema,
      response: {
        200: bulkOperationResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, DeptAdminController.bulkProfileOperation);

  // Badge Management - Department scoped
  f.post('/v1/admin/dept/badges/award', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Award badge to department student',
      description: 'Award a badge to a student in admin\'s department',
      body: awardBadgeSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, DeptAdminController.awardBadge);

  f.get('/v1/admin/dept/badges/leaderboard', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department badge leaderboard',
      description: 'Retrieve badge leaderboard for admin\'s department',
      querystring: { type: 'object', properties: { limit: { type: 'string' } } },
      response: {
        200: badgeLeaderboardResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getBadgeLeaderboard);

  // Analytics - Department scoped
  f.get('/v1/admin/dept/analytics', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department analytics',
      description: 'Retrieve analytics data specific to admin\'s department',
      querystring: { type: 'object', properties: { type: { type: 'string', enum: ['skills', 'placement', 'overview'] } } },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getAnalytics);

  // Completion Statistics - Department scoped
  f.get('/v1/admin/dept/completion-stats', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department completion statistics',
      description: 'Retrieve profile completion statistics for admin\'s department',
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getCompletionStats);

  // Data Export - Department scoped
  f.get('/v1/admin/dept/export', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Export department profile data',
      description: 'Export profile data for admin\'s department in CSV format',
      querystring: { type: 'object', properties: { type: { type: 'string', enum: ['profiles', 'badges', 'analytics'] }, format: { type: 'string', enum: ['csv', 'json'] } } },
      response: {
        200: { type: 'string', description: 'CSV or JSON file content' },
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, DeptAdminController.exportData);
}

export default deptAdminRoutes;
