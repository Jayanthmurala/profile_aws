import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAdmin, requireHeadAdmin } from '../middleware/adminAuth';
import { HeadAdminController } from '../controllers/HeadAdminController';
import {
  updateProfileSchema,
  bulkProfileOperationSchema,
  profileRequirementsSchema,
  profileFiltersSchema,
  paginationSchema,
  profileParamsSchema,
  profileResponseSchema,
  profilesListResponseSchema,
  bulkOperationResponseSchema,
  errorResponseSchema
} from '../validators/adminProfileSchemas';
import {
  createBadgeSchema,
  updateBadgeSchema,
  awardBadgeSchema,
  bulkBadgeOperationSchema,
  badgePolicySchema,
  badgeFiltersSchema,
  badgeParamsSchema,
  badgeDefinitionResponseSchema,
  badgesListResponseSchema,
  badgeLeaderboardResponseSchema,
  badgeStatisticsResponseSchema
} from '../validators/adminBadgeSchemas';

export async function headAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply admin authentication to all routes
  f.addHook('preHandler', requireAdmin);
  f.addHook('preHandler', requireHeadAdmin);

  // Dashboard
  f.get('/v1/admin/head/dashboard', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get HEAD_ADMIN dashboard data',
      description: 'Retrieve comprehensive dashboard with profile analytics, badge statistics, and completion rates',
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getDashboard);

  // Profile Management
  f.get('/v1/admin/head/profiles', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get profiles with filtering',
      description: 'Retrieve all profiles in the college with advanced filtering options',
      querystring: profileFiltersSchema.merge(paginationSchema),
      response: {
        200: profilesListResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getProfiles);

  f.get('/v1/admin/head/profiles/:userId', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get single profile',
      description: 'Retrieve detailed profile information',
      params: profileParamsSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: profileResponseSchema } },
        404: errorResponseSchema
      }
    }
  }, HeadAdminController.getProfile);

  f.put('/v1/admin/head/profiles/:userId', {
    schema: {
      tags: ['head-admin'],
      summary: 'Update profile',
      description: 'Update user profile information',
      params: profileParamsSchema,
      body: updateProfileSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: profileResponseSchema } },
        400: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, HeadAdminController.updateProfile);

  f.post('/v1/admin/head/profiles/bulk', {
    schema: {
      tags: ['head-admin'],
      summary: 'Bulk profile operations',
      description: 'Perform bulk operations on profiles (update, approve, reject)',
      body: bulkProfileOperationSchema,
      response: {
        200: bulkOperationResponseSchema,
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.bulkProfileOperation);

  // Badge Management
  f.post('/v1/admin/head/badges', {
    schema: {
      tags: ['head-admin'],
      summary: 'Create badge definition',
      description: 'Create a new college-specific badge',
      body: createBadgeSchema,
      response: {
        201: { type: 'object', properties: { success: { type: 'boolean' }, data: badgeDefinitionResponseSchema } },
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.createBadge);

  f.post('/v1/admin/head/badges/award', {
    schema: {
      tags: ['head-admin'],
      summary: 'Award badge to student',
      description: 'Award a badge to a student with reason',
      body: awardBadgeSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.awardBadge);

  f.get('/v1/admin/head/badges/leaderboard', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get badge leaderboard',
      description: 'Retrieve college badge leaderboard',
      querystring: { type: 'object', properties: { limit: { type: 'string' } } },
      response: {
        200: badgeLeaderboardResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getBadgeLeaderboard);

  // Analytics
  f.get('/v1/admin/head/analytics', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get analytics data',
      description: 'Retrieve various analytics (profile, skills, placement)',
      querystring: { type: 'object', properties: { type: { type: 'string', enum: ['skills', 'placement', 'overview'] } } },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getAnalytics);

  // Profile Requirements
  f.post('/v1/admin/head/requirements', {
    schema: {
      tags: ['head-admin'],
      summary: 'Set profile requirements',
      description: 'Configure profile completion requirements for the college',
      body: profileRequirementsSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.setProfileRequirements);
}

export default headAdminRoutes;
