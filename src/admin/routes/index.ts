import { FastifyInstance } from 'fastify';
import headAdminRoutes from './headAdmin.routes';
import deptAdminRoutes from './deptAdmin.routes';

/**
 * Register all admin routes for profile service
 */
export async function adminRoutes(app: FastifyInstance) {
  // Register HEAD_ADMIN routes
  await app.register(headAdminRoutes);
  
  // Register DEPT_ADMIN routes
  await app.register(deptAdminRoutes);
  
  // Health check for admin routes
  app.get('/v1/admin/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'profile-admin-routes',
      timestamp: new Date().toISOString(),
      routes: {
        headAdmin: 'available',
        deptAdmin: 'available',
        placementsAdmin: 'coming-soon'
      }
    };
  });
}

export default adminRoutes;
