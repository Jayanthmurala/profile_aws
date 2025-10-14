import { FastifyInstance } from "fastify";
import { z } from "zod";
import axios from "axios";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireSystemAuth, requireSystemPermission } from "../middleware/systemAuth.js";
import { validateProjectOwnership, validatePublicationOwnership, validateExperienceOwnership, validateCrossCollegeAccess } from "../middleware/ownershipValidation.js";
import { errorResponseSchema, messageResponseSchema } from "../schemas/profile.schemas.js";
import { AuthServiceClient } from "../utils/AuthServiceClient.js";
import { BadgePostService } from "../utils/BadgePostService.js";
import { RedisCache } from "../utils/redisClient.js";
import { profileCache, searchCache, directoryCache, badgeCache, statsCache, CacheInvalidator } from "../middleware/caching.js";

// Validation schemas
const updateProfileSchema = z.object({
  // User model fields (displayName and avatarUrl are editable)
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  
  // User model fields that need to be updated via auth service
  year: z.number().int().min(1).max(6).optional(),
  department: z.string().max(100).optional(),
  
  // Profile model fields (all editable)
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(1000).optional(),
  skills: z.array(z.string()).optional(),
  expertise: z.array(z.string()).optional(),
  linkedIn: z.string().url().optional().or(z.literal("")),
  github: z.string().url().optional().or(z.literal("")),
  twitter: z.string().url().optional().or(z.literal("")),
  resumeUrl: z.string().url().optional().or(z.literal("")),
  avatar: z.string().url().optional().or(z.literal("")),
  contactInfo: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
  alternateEmail: z.string().email().optional(),
});

const createProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(1000).optional(),
  skills: z.array(z.string()).optional(),
  linkedIn: z.string().url().optional().or(z.literal("")),
  github: z.string().url().optional().or(z.literal("")),
  twitter: z.string().url().optional().or(z.literal("")),
  resumeUrl: z.string().url().optional().or(z.literal("")),
  contactInfo: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
  alternateEmail: z.string().email().optional(),
});

const personalProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  github: z.string().url().optional().or(z.literal("")),
  demoLink: z.string().url().optional().or(z.literal("")),
  image: z.string().url().optional().or(z.literal("")),
});

const experienceSchema = z.object({
  area: z.string().min(1), // AI, IoT, Machine Learning, etc.
  level: z.enum(["Beginner", "Intermediate", "Advanced", "Expert"]),
  yearsExp: z.number().min(0).max(50).optional(),
  description: z.string().optional(),
});

const publicationSchema = z.object({
  title: z.string().min(1),
  year: z.number().min(1900).max(new Date().getFullYear()),
  link: z.string().url().optional().or(z.literal("")),
});

const badgeDefinitionSchema = z.object({
  name: z.string().min(1, "Badge name is required").max(100, "Badge name too long"),
  description: z.string().min(1, "Description is required").max(500, "Description too long"),
  icon: z.string().optional(), // Allow any string (emojis or URLs)
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format").optional(),
  category: z.string().max(50, "Category name too long").optional(),
  criteria: z.string().max(1000, "Criteria too long").optional(),
  rarity: z.enum(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]).default("COMMON"),
  points: z.number().int().min(1, "Points must be at least 1").max(1000, "Points too high").default(10),
  isActive: z.boolean().default(true),
  collegeId: z.string().cuid("Invalid college ID").optional(),
});

const awardBadgeSchema = z.object({
  badgeDefinitionId: z.string().cuid(),
  userId: z.string().cuid(),
  reason: z.string().min(1, "Reason is required"),
  projectId: z.string().cuid().optional(),
  eventId: z.string().cuid().optional(),
  awardedByName: z.string().optional(),
});

export default async function profileRoutes(app: FastifyInstance) {
  // Public: List colleges (no auth required)
  app.get("/v1/colleges", {
    schema: {
      tags: ["colleges"],
      response: { 200: z.any() },
    },
  }, async (_req, reply) => {
    try {
      // Forward request to auth-service
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const response = await fetch(`${authServiceUrl}/v1/colleges`);
      
      if (!response.ok) {
        return reply.code(response.status).send({ 
          message: "Failed to fetch colleges from auth service" 
        });
      }
      
      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      return reply.code(500).send({ 
        message: "Internal server error while fetching colleges" 
      });
    }
  });

  // Protected: Get my profile (frontend compatible endpoint with enhanced data)
  app.get("/v1/profile/me", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in profile request');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context'
        });
      }

      req.log.info({ userId }, 'Fetching profile for user');

      // Check cache first
      const cacheKey = `profile:${userId}`;
      const cachedProfile = await RedisCache.get<any>(cacheKey);
      
      if (cachedProfile && typeof cachedProfile === 'object') {
        req.log.info({ userId, source: 'cache' }, 'Profile served from cache');
        return reply.send({
          success: true,
          profile: {
            ...cachedProfile,
            _metadata: {
              ...(cachedProfile._metadata || {}),
              source: 'cache',
              responseTime: Date.now() - startTime
            }
          }
        });
      }

      // Create timeout promise for external calls
      const createTimeout = (ms: number, operation: string) => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms)
        );

      // Get profile from database with timeout protection
      const initialProfile = await Promise.race([
        prisma.profile.findUnique({
          where: { userId },
          include: {
            personalProjects: {
              take: 20, // Limit to prevent large payloads
              orderBy: { createdAt: 'desc' }
            },
            publications: {
              take: 20, // Limit to prevent large payloads
              orderBy: { createdAt: 'desc' }
            },
            experiences: {
              take: 10, // Limit to prevent large payloads
              orderBy: { createdAt: 'desc' }
            },
            studentBadges: {
              take: 50, // Limit badges to prevent memory issues
              orderBy: { awardedAt: 'desc' },
              include: {
                badge: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    icon: true,
                    color: true,
                    category: true,
                    rarity: true,
                    points: true
                  }
                }
              }
            }
          }
        }),
        createTimeout(10000, 'Database query')
      ]);

      // Get user info from auth service with timeout and error handling
      let userInfo: any = null;
      let collegeName: string | null = null;

      try {
        userInfo = await Promise.race([
          AuthServiceClient.getUser(userId, req.headers.authorization || ''),
          createTimeout(5000, 'Auth service user fetch')
        ]);

        // Fetch college name if collegeId exists
        if (userInfo?.collegeId) {
          try {
            const college = await Promise.race([
              AuthServiceClient.getCollege(userInfo.collegeId, req.headers.authorization || ''),
              createTimeout(5000, 'Auth service college fetch')
            ]);
            collegeName = (college as any)?.name || null;
          } catch (collegeError) {
            req.log.warn({ 
              error: collegeError instanceof Error ? collegeError.message : 'Unknown error',
              collegeId: userInfo.collegeId,
              userId 
            }, 'Failed to fetch college info, continuing without it');
            // Continue without college name - not critical
          }
        }
      } catch (authError) {
        req.log.warn({ 
          error: authError instanceof Error ? authError.message : 'Unknown error',
          userId 
        }, 'Failed to fetch user info from auth service, using profile data only');
        // Continue with profile data only - auth service failure shouldn't break the endpoint
      }

      // Auto-populate name from displayName if null and userInfo is available
      let profile: any = initialProfile;
      if (userInfo?.displayName && (!initialProfile || !(initialProfile as any)?.name)) {
        try {
          profile = await Promise.race([
            prisma.profile.upsert({
              where: { userId },
              update: { name: userInfo.displayName },
              create: { 
                userId,
                name: userInfo.displayName,
                skills: [],
                expertise: [],
              },
              include: {
                personalProjects: {
                  take: 20,
                  orderBy: { createdAt: 'desc' }
                },
                publications: {
                  take: 20,
                  orderBy: { createdAt: 'desc' }
                },
                experiences: {
                  take: 10,
                  orderBy: { createdAt: 'desc' }
                },
                studentBadges: {
                  take: 50,
                  orderBy: { awardedAt: 'desc' },
                  include: {
                    badge: {
                      select: {
                        id: true,
                        name: true,
                        description: true,
                        icon: true,
                        color: true,
                        category: true,
                        rarity: true,
                        points: true
                      }
                    }
                  }
                }
              }
            }),
            createTimeout(10000, 'Profile upsert')
          ]);
        } catch (upsertError) {
          req.log.error({ 
            error: upsertError instanceof Error ? upsertError.message : 'Unknown error',
            userId 
          }, 'Failed to upsert profile, using existing data');
          // Use existing profile data if upsert fails
        }
      }

      // Safely extract profile data with null checks
      const safeProfile: any = profile || {};
      
      // Combine profile and user data with safe access
      const enhancedProfile = {
        id: safeProfile.id || '',
        userId,
        name: safeProfile.name || userInfo?.displayName || '',
        displayName: userInfo?.displayName || safeProfile.name || '',
        // Remove sensitive data from response
        avatarUrl: userInfo?.avatarUrl || '',
        bio: safeProfile.bio || '',
        skills: Array.isArray(safeProfile.skills) ? safeProfile.skills : [],
        expertise: Array.isArray(safeProfile.expertise) ? safeProfile.expertise : [],
        linkedIn: safeProfile.linkedIn || '',
        github: safeProfile.github || '',
        twitter: safeProfile.twitter || '',
        resumeUrl: safeProfile.resumeUrl || '',
        collegeName: collegeName,
        collegeId: userInfo?.collegeId || '',
        department: safeProfile.department || userInfo?.department || '',
        year: safeProfile.year || userInfo?.year || null,
        roles: Array.isArray(userInfo?.roles) ? userInfo.roles : [],
        joinedAt: userInfo?.createdAt || safeProfile.createdAt,
        experiences: Array.isArray(safeProfile.experiences) ? safeProfile.experiences : [],
        badges: Array.isArray(safeProfile.studentBadges) ? safeProfile.studentBadges : [],
        projects: Array.isArray(safeProfile.personalProjects) ? safeProfile.personalProjects : [],
        publications: Array.isArray(safeProfile.publications) ? safeProfile.publications : [],
        // Add metadata for debugging and monitoring
        _metadata: {
          hasAuthData: !!userInfo,
          hasProfileData: !!profile,
          responseTime: Date.now() - startTime
        }
      };

      // Cache the profile data for future requests
      try {
        await RedisCache.set(cacheKey, enhancedProfile, 900); // Cache for 15 minutes
        req.log.debug({ userId }, 'Profile cached successfully');
      } catch (cacheError) {
        req.log.warn({ 
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          userId 
        }, 'Failed to cache profile data');
        // Don't fail the request if caching fails
      }

      // Log successful response for monitoring
      req.log.info({ 
        userId, 
        responseTime: Date.now() - startTime,
        hasAuthData: !!userInfo,
        hasProfileData: !!profile,
        badgeCount: enhancedProfile.badges.length,
        projectCount: enhancedProfile.projects.length,
        source: 'database'
      }, 'Profile fetched successfully');

      return reply.send({ 
        success: true,
        profile: enhancedProfile 
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log detailed error for debugging
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'GET /v1/profile/me'
      }, 'Failed to fetch user profile');

      // Handle specific error types
      if (error instanceof Error) {
        // Database connection errors
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }

        // Auth service errors
        if (error.message.includes('Auth service') || error.message.includes('timeout')) {
          return reply.code(502).send({
            success: false,
            message: 'Unable to fetch complete profile data. Please try again later.',
            code: 'EXTERNAL_SERVICE_ERROR'
          });
        }

        // Validation errors
        if (error.message.includes('Invalid') || error.message.includes('validation')) {
          return reply.code(400).send({
            success: false,
            message: 'Invalid request data',
            code: 'VALIDATION_ERROR'
          });
        }
      }

      // Generic server error (don't expose internal details)
      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while fetching your profile',
        code: 'INTERNAL_ERROR',
        // Only include error details in development
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: Create/Update my profile (frontend compatible endpoint)
  app.put("/v1/profile/me", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      body: updateProfileSchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in profile update');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context'
        });
      }

      const data = req.body as z.infer<typeof updateProfileSchema>;
      req.log.info({ userId, updateFields: Object.keys(data) }, 'Updating user profile');

    // Separate user model fields from profile model fields
    const { displayName, avatarUrl, year, department, ...profileData } = data;

    // Update user model fields in auth service if provided
    if (displayName || avatarUrl || year !== undefined || department) {
      const updateData: any = {};
      if (displayName) updateData.displayName = displayName;
      if (avatarUrl) updateData.avatarUrl = avatarUrl;
      if (year !== undefined) updateData.year = year;
      if (department) updateData.department = department;
      
      try {
        const success = await Promise.race([
          AuthServiceClient.updateUser(userId, updateData, req.headers.authorization || ''),
          new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error('Auth service update timeout')), 10000)
          )
        ]);
        
        if (!success) {
          return reply.code(502).send({ 
            success: false,
            message: "Failed to update user data in auth service",
            code: 'AUTH_SERVICE_ERROR'
          });
        }
      } catch (authError) {
        req.log.error({ 
          error: authError instanceof Error ? authError.message : 'Unknown error',
          userId,
          updateData 
        }, 'Failed to update user data in auth service');
        
        return reply.code(502).send({ 
          success: false,
          message: "Unable to update user information. Please try again later.",
          code: 'AUTH_SERVICE_ERROR'
        });
      }
    }

    // If avatarUrl is provided, also update the avatar field in profile
    if (avatarUrl) {
      profileData.avatar = avatarUrl;
    }

    // Update profile data in profile service with timeout protection
    const updatedProfile = await Promise.race([
      prisma.profile.upsert({
        where: { userId },
        update: profileData,
        create: { 
          userId,
          skills: [],
          expertise: [],
          ...profileData
        },
      }),
      new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error('Profile update timeout')), 10000)
      )
    ]);

    // Invalidate cache after successful update
    const cacheKey = `profile:${userId}`;
    try {
      await RedisCache.del(cacheKey);
      req.log.debug({ userId }, 'Profile cache invalidated after update');
    } catch (cacheError) {
      req.log.warn({ 
        error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
        userId 
      }, 'Failed to invalidate profile cache');
    }

    // Log successful update
    req.log.info({ 
      userId, 
      updatedFields: Object.keys(profileData),
      responseTime: Date.now() - startTime
    }, 'Profile updated successfully');

    return reply.send({ 
      success: true,
      profile: updatedProfile,
      message: 'Profile updated successfully'
    });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'PUT /v1/profile/me'
      }, 'Failed to update profile');

      if (error instanceof Error) {
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }
      }

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while updating your profile',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: Get user profile by ID (for viewing other users)
  app.get("/v1/profile/:userId", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      params: z.object({ userId: z.string().cuid() }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };

    // Get profile from database
    const initialProfile = await prisma.profile.findUnique({
      where: { userId },
      include: {
        personalProjects: true,
        publications: true,
        experiences: true,
        studentBadges: {
          include: {
            badge: true,
          },
        },
      },
    });

    // Get user info from auth service
    const userInfo = await AuthServiceClient.getUser(userId, req.headers.authorization || '');
    let collegeName: string | null = null;
    
    // Fetch college name if collegeId exists
    if (userInfo?.collegeId) {
      const college = await AuthServiceClient.getCollege(userInfo.collegeId, req.headers.authorization || '');
      collegeName = college?.name || null;
    }

    // Auto-populate name from displayName if null and userInfo is available
    let profile = initialProfile;
    if (userInfo?.displayName && (!initialProfile || !(initialProfile as any)?.name)) {
      profile = await prisma.profile.upsert({
        where: { userId },
        update: { name: userInfo.displayName },
        create: { 
          userId,
          name: userInfo.displayName,
          skills: [],
          expertise: [],
        },
        include: {
          personalProjects: true,
          publications: true,
          experiences: true,
          studentBadges: {
            include: {
              badge: true,
            },
          },
        },
      });
    }

    // Combine profile and user data (use auth service avatarUrl as primary source)
    const enhancedProfile = {
      id: profile?.id || '',
      userId,
      name: (profile as any)?.name || userInfo?.displayName || '',
      displayName: userInfo?.displayName || '',
      email: userInfo?.email || '',
      avatarUrl: userInfo?.avatarUrl || '',
      bio: (profile as any)?.bio || '',
      skills: (profile as any)?.skills || [],
      expertise: (profile as any)?.expertise || [],
      linkedIn: (profile as any)?.linkedIn || '',
      github: (profile as any)?.github || '',
      twitter: (profile as any)?.twitter || '',
      resumeUrl: (profile as any)?.resumeUrl || '',
      contactInfo: (profile as any)?.contactInfo || '',
      phoneNumber: (profile as any)?.phoneNumber || '',
      alternateEmail: (profile as any)?.alternateEmail || '',
      collegeName: collegeName,
      collegeId: userInfo?.collegeId || '',
      collegeMemberId: userInfo?.collegeMemberId || '',
      department: (profile as any)?.department || userInfo?.department || '',
      year: (profile as any)?.year || userInfo?.year || null,
      roles: userInfo?.roles || [],
      joinedAt: userInfo?.createdAt || profile?.createdAt,
      experiences: profile?.experiences || [],
      badges: profile?.studentBadges || [],
      projects: profile?.personalProjects || [],
      publications: profile?.publications || [],
    };

    return reply.send({ profile: enhancedProfile });
  });


  // Protected: Get my personal projects
  app.get("/v1/profile/me/projects", {
    preHandler: requireAuth,
    schema: {
      tags: ["projects"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;

    const projects = await prisma.personalProject.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ projects });
  });

  // Protected: Get my publications
  app.get("/v1/profile/me/publications", {
    preHandler: requireAuth,
    schema: {
      tags: ["publications"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;

    const publications = await prisma.publication.findMany({
      where: { userId },
      orderBy: { year: 'desc' },
    });

    return reply.send({ publications });
  });

  // Protected: Create personal project
  app.post("/v1/profiles/me/projects", {
    preHandler: requireAuth,
    schema: {
      tags: ["projects"],
      body: personalProjectSchema,
      response: { 201: z.any() },
    },
  }, async (req, reply) => {
    const data = req.body as z.infer<typeof personalProjectSchema>;

    // Ensure profile exists
    await prisma.profile.upsert({
      where: { userId: req.user!.sub },
      update: {},
      create: { 
        userId: req.user!.sub,
        skills: [],
        expertise: [],
      },
    });

    const project = await prisma.personalProject.create({
      data: {
        ...data,
        profile: { connect: { userId: req.user!.sub } },
      },
    });

    return reply.code(201).send({ project });
  });

  // Protected: Update personal project
  app.put("/v1/profiles/me/projects/:projectId", {
    preHandler: [requireAuth, validateProjectOwnership],
    schema: {
      tags: ["projects"],
      params: z.object({ projectId: z.string().cuid() }),
      body: personalProjectSchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const data = req.body as z.infer<typeof personalProjectSchema>;

    // Check ownership
    const existingProject = await prisma.personalProject.findFirst({
      where: { 
        id: projectId,
        profile: { userId: req.user!.sub },
      },
    });

    if (!existingProject) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const project = await prisma.personalProject.update({
      where: { id: projectId },
      data,
    });

    return reply.send({ project });
  });

  // Protected: Delete personal project
  app.delete("/v1/profiles/me/projects/:projectId", {
    preHandler: [requireAuth, validateProjectOwnership],
    schema: {
      tags: ["projects"],
      params: z.object({ projectId: z.string().cuid() }),
      response: { 204: z.any() },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };

    // Check ownership
    const existingProject = await prisma.personalProject.findFirst({
      where: { 
        id: projectId,
        profile: { userId: req.user!.sub },
      },
    });

    if (!existingProject) {
      return reply.code(404).send({ message: "Project not found" });
    }

    await prisma.personalProject.delete({
      where: { id: projectId },
    });

    return reply.code(204).send();
  });

  // Protected: Create publication (Faculty only)
  app.post("/v1/profiles/me/publications", {
    preHandler: [requireAuth, requireRole(["FACULTY", "HEAD_ADMIN"])],
    schema: {
      tags: ["publications"],
      body: publicationSchema,
      response: { 201: z.any() },
    },
  }, async (req, reply) => {
    const data = req.body as z.infer<typeof publicationSchema>;

    // Ensure profile exists
    await prisma.profile.upsert({
      where: { userId: req.user!.sub },
      update: {},
      create: { 
        userId: req.user!.sub,
        skills: [],
        expertise: [],
      },
    });

    const publication = await prisma.publication.create({
      data: {
        ...data,
        type: "JOURNAL", // Default type for legacy publications
        profile: { connect: { userId: req.user!.sub } },
      },
    });

    return reply.code(201).send({ publication });
  });

  // Protected: Update publication (Faculty only)
  app.put("/v1/profiles/me/publications/:publicationId", {
    preHandler: [requireAuth, requireRole(["FACULTY", "HEAD_ADMIN"]), validatePublicationOwnership],
    schema: {
      tags: ["publications"],
      params: z.object({ publicationId: z.string().cuid() }),
      body: publicationSchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { publicationId } = req.params as { publicationId: string };
    const data = req.body as z.infer<typeof publicationSchema>;

    // Check ownership
    const existingPublication = await prisma.publication.findFirst({
      where: { 
        id: publicationId,
        profile: { userId: req.user!.sub },
      },
    });

    if (!existingPublication) {
      return reply.code(404).send({ message: "Publication not found" });
    }

    const publication = await prisma.publication.update({
      where: { id: publicationId },
      data,
    });

    return reply.send({ publication });
  });

  // Protected: Delete publication (Faculty only)
  app.delete("/v1/profiles/me/publications/:publicationId", {
    preHandler: [requireAuth, requireRole(["FACULTY", "HEAD_ADMIN"]), validatePublicationOwnership],
    schema: {
      tags: ["publications"],
      params: z.object({ publicationId: z.string().cuid() }),
      response: { 204: z.any() },
    },
  }, async (req, reply) => {
    const { publicationId } = req.params as { publicationId: string };

    // Check ownership
    const existingPublication = await prisma.publication.findFirst({
      where: { 
        id: publicationId,
        profile: { userId: req.user!.sub },
      },
    });

    if (!existingPublication) {
      return reply.code(404).send({ message: "Publication not found" });
    }

    await prisma.publication.delete({
      where: { id: publicationId },
    });

    return reply.code(204).send({ message: "Publication deleted successfully" });
  });

  // Protected: Get my experiences
  app.get("/v1/profile/me/experiences", {
    preHandler: requireAuth,
    schema: {
      tags: ["experiences"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { experiences: true },
    });

    return reply.send({ experiences: profile?.experiences || [] });
  });

  // Protected: Create experience
  app.post("/v1/profile/experiences", {
    preHandler: requireAuth,
    schema: {
      tags: ["experiences"],
      body: experienceSchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const data = req.body as z.infer<typeof experienceSchema>;
    const userId = req.user!.sub;

    // Ensure profile exists
    await prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { 
        userId,
        skills: [],
        expertise: [],
      },
    });

    const experience = await prisma.experience.create({
      data: {
        ...data,
        userId, // Required field
        title: data.area || "Experience", // Use area as title for legacy compatibility
        company: "Not specified", // Default company name
        startDate: new Date(), // Default to current date
        type: "INTERNSHIP", // Default type
        profile: { connect: { userId } },
      },
    });

    return reply.send({ experience });
  });

  // Protected: Update experience
  app.put("/v1/profile/experiences/:id", {
    preHandler: [requireAuth, validateExperienceOwnership],
    schema: {
      tags: ["experiences"],
      params: z.object({ id: z.string().cuid() }),
      body: experienceSchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = req.body as z.infer<typeof experienceSchema>;
    const userId = req.user!.sub;

    // Verify ownership through profile
    const existingExperience = await prisma.experience.findFirst({
      where: { 
        id,
        profile: { userId }
      },
    });

    if (!existingExperience) {
      return reply.code(404).send({ message: "Experience not found or access denied" });
    }

    const experience = await prisma.experience.update({
      where: { id },
      data,
    });

    return reply.send({ experience });
  });

  // Protected: Delete experience
  app.delete("/v1/profile/experiences/:id", {
    preHandler: [requireAuth, validateExperienceOwnership],
    schema: {
      tags: ["profiles"],
      params: z.object({ id: z.string().cuid() }),
      response: { 200: z.any(), 404: errorResponseSchema },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.sub;

    // Check if experience exists and belongs to user
    const experience = await prisma.experience.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (!experience || experience.profile.userId !== userId) {
      return reply.code(404).send({ message: "Experience not found" });
    }

    await prisma.experience.delete({
      where: { id },
    });

    return reply.send({ message: "Experience deleted successfully" });
  });

  // Skills CRUD endpoints
  
  // Protected: Get my skills
  app.get("/v1/profile/me/skills", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      response: { 200: z.object({ skills: z.array(z.string()) }) },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { skills: true },
    });

    return reply.send({ skills: profile?.skills || [] });
  });

  // Protected: Update my skills
  app.put("/v1/profile/me/skills", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      body: z.object({ skills: z.array(z.string()) }),
      response: { 200: z.object({ skills: z.array(z.string()) }) },
    },
  }, async (req, reply) => {
    const { skills } = req.body as { skills: string[] };
    const userId = req.user!.sub;

    // Validate and clean skills
    const cleanedSkills = skills
      .map(skill => skill.trim())
      .filter(skill => skill.length > 0)
      .slice(0, 50); // Limit to 50 skills

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: { skills: cleanedSkills },
      create: {
        userId,
        skills: cleanedSkills,
        expertise: [],
      },
      select: { skills: true },
    });

    return reply.send({ skills: profile.skills });
  });

  // Protected: Add a skill
  app.post("/v1/profile/me/skills", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      body: z.object({ skill: z.string().min(1).max(100) }),
      response: { 200: z.object({ skills: z.array(z.string()) }) },
    },
  }, async (req, reply) => {
    const { skill } = req.body as { skill: string };
    const userId = req.user!.sub;

    const cleanedSkill = skill.trim();
    if (!cleanedSkill) {
      return reply.code(400).send({ message: "Skill cannot be empty" });
    }

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { skills: true },
    });

    const currentSkills = profile?.skills || [];
    
    // Check if skill already exists (case insensitive)
    if (currentSkills.some(s => s.toLowerCase() === cleanedSkill.toLowerCase())) {
      return reply.code(400).send({ message: "Skill already exists" });
    }

    // Limit to 50 skills
    if (currentSkills.length >= 50) {
      return reply.code(400).send({ message: "Maximum 50 skills allowed" });
    }

    const updatedSkills = [...currentSkills, cleanedSkill];

    const updatedProfile = await prisma.profile.upsert({
      where: { userId },
      update: { skills: updatedSkills },
      create: {
        userId,
        skills: updatedSkills,
        expertise: [],
      },
      select: { skills: true },
    });

    return reply.send({ skills: updatedProfile.skills });
  });

  // Protected: Remove a skill
  app.delete("/v1/profile/me/skills/:skill", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      params: z.object({ skill: z.string() }),
      response: { 200: z.object({ skills: z.array(z.string()) }) },
    },
  }, async (req, reply) => {
    const { skill } = req.params as { skill: string };
    const userId = req.user!.sub;

    const decodedSkill = decodeURIComponent(skill);

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { skills: true },
    });

    const currentSkills = profile?.skills || [];
    const updatedSkills = currentSkills.filter(s => s !== decodedSkill);

    const updatedProfile = await prisma.profile.upsert({
      where: { userId },
      update: { skills: updatedSkills },
      create: {
        userId,
        skills: updatedSkills,
        expertise: [],
      },
      select: { skills: true },
    });

    return reply.send({ skills: updatedProfile.skills });
  });

  // Protected: Get users directory for network discovery
  app.get("/v1/users", {
    preHandler: requireAuth,
    schema: {
      tags: ["users"],
      querystring: z.object({
        offset: z.string().transform(Number).optional(),
        limit: z.string().transform(Number).optional(),
        search: z.string().optional(),
        collegeId: z.string().optional(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { offset = 0, limit = 20, search, collegeId } = req.query as any;

    try {
      // Get users from auth service
      const usersData = await AuthServiceClient.getUsers({
        offset,
        limit: Math.min(limit, 100),
        search,
        collegeId
      }, req.headers.authorization || '');

      if (!usersData || !usersData.users) {
        return reply.send({
          users: [],
          nextOffset: offset,
          hasMore: false,
          totalCount: 0
        });
      }

      // Enhance users with profile data
      const enhancedUsers = await Promise.all(
        usersData.users.map(async (user: any) => {
          try {
            const profile = await prisma.profile.findUnique({
              where: { userId: user.id },
              select: {
                name: true,
                bio: true,
                skills: true,
              },
            });

            return {
              id: user.id,
              name: profile?.name || user.displayName || user.name,
              email: user.email,
              avatarUrl: user.avatarUrl,
              college: user.collegeName,
              collegeId: user.collegeId,
              department: user.department,
              year: user.year,
              bio: profile?.bio,
              skills: profile?.skills || [],
            };
          } catch (error) {
            console.error(`Error enhancing user ${user.id}:`, error);
            return {
              id: user.id,
              name: user.displayName || user.name,
              email: user.email,
              avatarUrl: user.avatarUrl,
              college: user.collegeName,
              collegeId: user.collegeId,
              department: user.department,
              year: user.year,
              bio: '',
              skills: [],
            };
          }
        })
      );

      return reply.send({
        users: enhancedUsers,
        nextOffset: usersData.nextOffset || offset + limit,
        hasMore: usersData.hasMore || false,
        totalCount: usersData.totalCount || enhancedUsers.length
      });
    } catch (error) {
      console.error('Error fetching users directory:', error);
      return reply.code(500).send({
        message: 'Failed to fetch users directory'
      });
    }
  });

  // Protected: Get user suggestions for follow recommendations
  app.get("/v1/users/suggestions", {
    preHandler: requireAuth,
    schema: {
      tags: ["users"],
      querystring: z.object({
        userId: z.string().optional(),
        limit: z.string().transform(Number).optional(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { userId, limit = 10 } = req.query as any;
    const currentUserId = userId || req.user!.sub;

    try {
      // Get user's college info for better suggestions
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      const userResponse = await axios.get(`${authServiceUrl}/v1/users/${currentUserId}`, {
        headers: {
          'Authorization': req.headers.authorization || '',
        },
        timeout: 5000,
      });

      const currentUser = userResponse.data.user;
      
      // Get users from same college
      const queryParams = new URLSearchParams();
      queryParams.append('limit', Math.min(limit * 2, 50).toString()); // Get more to filter
      if (currentUser?.collegeId) {
        queryParams.append('collegeId', currentUser.collegeId);
      }

      const suggestionsResponse = await axios.get(`${authServiceUrl}/v1/users?${queryParams}`, {
        headers: {
          'Authorization': req.headers.authorization || '',
        },
        timeout: 10000,
      });

      if (!suggestionsResponse.data || !suggestionsResponse.data.users) {
        return reply.send({ users: [] });
      }

      // Filter out current user and enhance with profile data
      const suggestions = suggestionsResponse.data.users
        .filter((user: any) => user.id !== currentUserId)
        .slice(0, limit);

      const enhancedSuggestions = await Promise.all(
        suggestions.map(async (user: any) => {
          try {
            const profile = await prisma.profile.findUnique({
              where: { userId: user.id },
              select: {
                name: true,
                bio: true,
                skills: true,
              },
            });

            return {
              id: user.id,
              name: profile?.name || user.displayName || user.name,
              avatarUrl: user.avatarUrl,
              college: user.collegeName,
              department: user.department,
              bio: profile?.bio,
              skills: profile?.skills || [],
            };
          } catch (error) {
            return {
              id: user.id,
              name: user.displayName || user.name,
              avatarUrl: user.avatarUrl,
              college: user.collegeName,
              department: user.department,
              bio: '',
              skills: [],
            };
          }
        })
      );

      return reply.send({ users: enhancedSuggestions });
    } catch (error) {
      console.error('Error fetching user suggestions:', error);
      return reply.send({ users: [] });
    }
  });

  // Protected: Create badge definition (Faculty/Admin only)
  app.post("/v1/badge-definitions", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      body: badgeDefinitionSchema,
      response: { 201: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in badge creation');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context',
          code: 'INVALID_AUTH_CONTEXT'
        });
      }

      const data = req.body as z.infer<typeof badgeDefinitionSchema>;
      
      req.log.info({ 
        userId, 
        badgeName: data.name,
        collegeId: data.collegeId 
      }, 'Creating badge definition');

      // Check for duplicate badge name in the same college scope
      const existingBadge = await Promise.race([
        prisma.badgeDefinition.findFirst({
          where: {
            name: data.name,
            collegeId: data.collegeId || null
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Duplicate check timeout')), 5000)
        )
      ]);

      if (existingBadge) {
        return reply.code(409).send({
          success: false,
          message: `Badge "${data.name}" already exists in this scope`,
          code: 'DUPLICATE_BADGE_NAME',
          details: {
            existingBadgeId: existingBadge.id,
            scope: data.collegeId ? 'college' : 'global'
          }
        });
      }

      // Prepare badge data with proper validation
      const createData: any = {
        name: data.name.trim(),
        description: data.description.trim(),
        rarity: data.rarity,
        points: data.points || 10,
        isActive: data.isActive !== undefined ? data.isActive : true,
        collegeId: data.collegeId || null,
        createdBy: userId,
      };

      // Add optional fields only if they exist and are not empty
      if (data.icon && data.icon.trim()) {
        createData.icon = data.icon.trim();
      }
      if (data.color && data.color.trim()) {
        createData.color = data.color.trim();
      }
      if (data.category && data.category.trim()) {
        createData.category = data.category.trim();
      }
      if (data.criteria && data.criteria.trim()) {
        createData.criteria = data.criteria.trim();
      }

      // Create badge definition with timeout protection
      const badgeDefinition = await Promise.race([
        prisma.badgeDefinition.create({
          data: createData,
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            color: true,
            category: true,
            rarity: true,
            points: true,
            isActive: true,
            createdAt: true,
            // Don't return: createdBy, collegeId, criteria (sensitive)
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Badge creation timeout')), 10000)
        )
      ]);

      // Log successful creation
      req.log.info({ 
        userId, 
        badgeId: badgeDefinition.id,
        badgeName: badgeDefinition.name,
        responseTime: Date.now() - startTime
      }, 'Badge definition created successfully');

      return reply.code(201).send({ 
        success: true,
        data: badgeDefinition,
        message: 'Badge definition created successfully'
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log detailed error for debugging
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'POST /v1/badge-definitions'
      }, 'Failed to create badge definition');

      // Handle specific error types
      if (error instanceof Error) {
        // Database connection errors
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }

        // Unique constraint violations
        if (error.message.includes('Unique constraint') || error.message.includes('unique')) {
          return reply.code(409).send({
            success: false,
            message: 'Badge name already exists in this scope',
            code: 'DUPLICATE_BADGE_NAME'
          });
        }

        // Validation errors
        if (error.message.includes('Invalid') || error.message.includes('validation')) {
          return reply.code(400).send({
            success: false,
            message: 'Invalid badge data provided',
            code: 'VALIDATION_ERROR'
          });
        }
      }

      // Generic server error
      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while creating the badge definition',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: List badge definitions with filtering and pagination
  app.get("/v1/badge-definitions", {
    preHandler: requireAuth,
    schema: {
      tags: ["badges"],
      summary: "Get badge definitions with filtering",
      description: "Retrieve badge definitions with pagination, filtering, and proper access control",
      querystring: z.object({
        page: z.string().transform(Number).pipe(z.number().int().min(1)).optional().default("1"),
        limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional().default("20"),
        collegeId: z.string().cuid().optional(),
        category: z.string().optional(),
        rarity: z.enum(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]).optional(),
        isActive: z.string().transform(val => val === 'true').optional().default("true"),
        search: z.string().optional()
      }),
      response: { 
        200: z.object({
          success: z.boolean(),
          data: z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            icon: z.string().nullable(),
            color: z.string().nullable(),
            category: z.string().nullable(),
            rarity: z.string(),
            points: z.number(),
            isActive: z.boolean()
          })),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
            totalPages: z.number()
          })
        })
      }
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in badge definitions request');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context',
          code: 'INVALID_AUTH_CONTEXT'
        });
      }

      const { page, limit, collegeId, category, rarity, isActive, search } = req.query as any;
      
      req.log.info({ 
        userId, 
        filters: { page, limit, collegeId, category, rarity, isActive, search }
      }, 'Fetching badge definitions');

      // Build where clause for filtering
      const whereClause: any = {
        isActive: isActive
      };

      // Add college filtering - show global badges (collegeId: null) and user's college badges
      if (collegeId) {
        whereClause.OR = [
          { collegeId: null }, // Global badges
          { collegeId: collegeId }
        ];
      } else {
        // If no specific college requested, show only global badges
        whereClause.collegeId = null;
      }

      // Add category filter
      if (category) {
        whereClause.category = category;
      }

      // Add rarity filter
      if (rarity) {
        whereClause.rarity = rarity;
      }

      // Add search filter
      if (search && search.trim()) {
        whereClause.OR = [
          ...(whereClause.OR || []),
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { description: { contains: search.trim(), mode: 'insensitive' } }
        ];
      }

      // Get total count for pagination
      const totalCount = await Promise.race([
        prisma.badgeDefinition.count({ where: whereClause }),
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Count query timeout')), 5000)
        )
      ]);

      // Get badge definitions with pagination
      const badgeDefinitions = await Promise.race([
        prisma.badgeDefinition.findMany({
          where: whereClause,
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            color: true,
            category: true,
            rarity: true,
            points: true,
            isActive: true,
            // Exclude sensitive fields: createdBy, collegeId, criteria, createdAt
          },
          orderBy: [
            { rarity: 'desc' }, // Show rarer badges first
            { createdAt: 'desc' }
          ],
          skip: (page - 1) * limit,
          take: limit
        }),
        new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Badge query timeout')), 10000)
        )
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      // Log successful response
      req.log.info({ 
        userId, 
        responseTime: Date.now() - startTime,
        resultCount: badgeDefinitions.length,
        totalCount,
        page,
        limit
      }, 'Badge definitions fetched successfully');

      return reply.send({
        success: true,
        data: badgeDefinitions,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log detailed error for debugging
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'GET /v1/badge-definitions'
      }, 'Failed to fetch badge definitions');

      // Handle specific error types
      if (error instanceof Error) {
        // Database connection errors
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }

        // Validation errors
        if (error.message.includes('Invalid') || error.message.includes('validation')) {
          return reply.code(400).send({
            success: false,
            message: 'Invalid request parameters',
            code: 'VALIDATION_ERROR'
          });
        }
      }

      // Generic server error
      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while fetching badge definitions',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: Update badge definition (Faculty/Admin only)
  app.put("/v1/badge-definitions/:id", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      summary: "Update badge definition",
      description: "Update an existing badge definition with proper authorization",
      params: z.object({
        id: z.string().cuid("Invalid badge ID")
      }),
      body: badgeDefinitionSchema.partial(),
      response: { 
        200: z.object({
          success: z.boolean(),
          data: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            icon: z.string().nullable(),
            color: z.string().nullable(),
            category: z.string().nullable(),
            rarity: z.string(),
            points: z.number(),
            isActive: z.boolean()
          }),
          message: z.string()
        })
      }
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in badge update');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context',
          code: 'INVALID_AUTH_CONTEXT'
        });
      }

      const { id } = req.params as { id: string };
      const data = req.body as Partial<z.infer<typeof badgeDefinitionSchema>>;
      
      req.log.info({ 
        userId, 
        badgeId: id,
        updateFields: Object.keys(data)
      }, 'Updating badge definition');

      // Check if badge exists and user has permission to update it
      const existingBadge = await Promise.race([
        prisma.badgeDefinition.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            collegeId: true,
            createdBy: true,
            isActive: true
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Badge lookup timeout')), 5000)
        )
      ]);

      if (!existingBadge) {
        return reply.code(404).send({
          success: false,
          message: 'Badge definition not found',
          code: 'BADGE_NOT_FOUND'
        });
      }

      // Check for name conflicts if name is being updated
      if (data.name && data.name !== existingBadge.name) {
        const nameConflict = await prisma.badgeDefinition.findFirst({
          where: {
            name: data.name,
            collegeId: data.collegeId || existingBadge.collegeId,
            id: { not: id }
          }
        });

        if (nameConflict) {
          return reply.code(409).send({
            success: false,
            message: `Badge name "${data.name}" already exists in this scope`,
            code: 'DUPLICATE_BADGE_NAME'
          });
        }
      }

      // Prepare update data
      const updateData: any = {};
      
      if (data.name !== undefined) updateData.name = data.name.trim();
      if (data.description !== undefined) updateData.description = data.description.trim();
      if (data.rarity !== undefined) updateData.rarity = data.rarity;
      if (data.points !== undefined) updateData.points = data.points;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.collegeId !== undefined) updateData.collegeId = data.collegeId;
      
      // Handle optional fields
      if (data.icon !== undefined) updateData.icon = data.icon?.trim() || null;
      if (data.color !== undefined) updateData.color = data.color?.trim() || null;
      if (data.category !== undefined) updateData.category = data.category?.trim() || null;
      if (data.criteria !== undefined) updateData.criteria = data.criteria?.trim() || null;

      // Update badge definition
      const updatedBadge = await Promise.race([
        prisma.badgeDefinition.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            color: true,
            category: true,
            rarity: true,
            points: true,
            isActive: true
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Badge update timeout')), 10000)
        )
      ]);

      // Log successful update
      req.log.info({ 
        userId, 
        badgeId: id,
        updatedFields: Object.keys(updateData),
        responseTime: Date.now() - startTime
      }, 'Badge definition updated successfully');

      return reply.send({
        success: true,
        data: updatedBadge,
        message: 'Badge definition updated successfully'
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'PUT /v1/badge-definitions/:id'
      }, 'Failed to update badge definition');

      if (error instanceof Error) {
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }

        if (error.message.includes('Unique constraint') || error.message.includes('unique')) {
          return reply.code(409).send({
            success: false,
            message: 'Badge name already exists in this scope',
            code: 'DUPLICATE_BADGE_NAME'
          });
        }
      }

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while updating the badge definition',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: Delete badge definition (Faculty/Admin only)
  app.delete("/v1/badge-definitions/:id", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      summary: "Delete badge definition",
      description: "Delete a badge definition (soft delete by setting isActive to false)",
      params: z.object({
        id: z.string().cuid("Invalid badge ID")
      }),
      response: { 
        200: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    let userId: string | undefined;

    try {
      // Validate user context
      userId = req.user?.sub;
      if (!userId || typeof userId !== 'string') {
        req.log.warn({ user: req.user }, 'Invalid user context in badge deletion');
        return reply.code(400).send({
          success: false,
          message: 'Invalid user authentication context',
          code: 'INVALID_AUTH_CONTEXT'
        });
      }

      const { id } = req.params as { id: string };
      
      req.log.info({ 
        userId, 
        badgeId: id
      }, 'Deleting badge definition');

      // Check if badge exists
      const existingBadge = await Promise.race([
        prisma.badgeDefinition.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: {
              select: {
                awards: true
              }
            }
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Badge lookup timeout')), 5000)
        )
      ]);

      if (!existingBadge) {
        return reply.code(404).send({
          success: false,
          message: 'Badge definition not found',
          code: 'BADGE_NOT_FOUND'
        });
      }

      if (!existingBadge.isActive) {
        return reply.code(400).send({
          success: false,
          message: 'Badge definition is already inactive',
          code: 'BADGE_ALREADY_INACTIVE'
        });
      }

      // Soft delete - set isActive to false instead of hard delete
      // This preserves data integrity for existing badge awards
      await Promise.race([
        prisma.badgeDefinition.update({
          where: { id },
          data: { 
            isActive: false
          }
        }),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Badge deletion timeout')), 10000)
        )
      ]);

      // Log successful deletion
      req.log.info({ 
        userId, 
        badgeId: id,
        badgeName: existingBadge.name,
        awardCount: existingBadge._count.awards,
        responseTime: Date.now() - startTime
      }, 'Badge definition soft deleted successfully');

      return reply.send({
        success: true,
        message: `Badge definition "${existingBadge.name}" has been deactivated successfully`
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      req.log.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        } : error,
        userId: userId || 'unknown',
        duration,
        endpoint: 'DELETE /v1/badge-definitions/:id'
      }, 'Failed to delete badge definition');

      if (error instanceof Error) {
        if (error.message.includes('connect') || error.message.includes('timeout')) {
          return reply.code(503).send({
            success: false,
            message: 'Service temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          });
        }
      }

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while deleting the badge definition',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      });
    }
  });

  // Protected: Award badge (Faculty/Admin only)
  app.post("/v1/badges/award", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      body: awardBadgeSchema,
      response: { 201: z.any() },
    },
  }, async (req, reply) => {
    const data = req.body as z.infer<typeof awardBadgeSchema>;
    
    console.log('Badge award request body:', JSON.stringify(req.body, null, 2));
    console.log('Validated data:', JSON.stringify(data, null, 2));
    
    // Verify the target user exists in auth service and get user info
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
    let studentInfo: any = null;
    try {
      const userResponse = await axios.get(`${authServiceUrl}/v1/users/${data.userId}`, {
        headers: {
          Authorization: req.headers.authorization,
        },
      });
      
      if (!userResponse.data) {
        return reply.code(404).send({
          error: "User not found",
          message: `User with ID ${data.userId} does not exist`,
        });
      }
      
      studentInfo = userResponse.data.user;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return reply.code(404).send({
          error: "User not found", 
          message: `User with ID ${data.userId} does not exist`,
        });
      }
      return reply.code(500).send({
        error: "Failed to verify user",
        message: "Could not verify user existence",
      });
    }

    // Ensure target user's profile exists
    await prisma.profile.upsert({
      where: { userId: data.userId },
      update: {},
      create: { 
        userId: data.userId,
        skills: [],
        expertise: [],
      },
    });

    // Check if student already has this badge
    const existingBadge = await prisma.studentBadge.findUnique({
      where: {
        badgeId_studentId: {
          badgeId: data.badgeDefinitionId,
          studentId: data.userId
        }
      }
    });

    if (existingBadge) {
      return reply.code(400).send({
        error: "Badge already awarded",
        message: `Student already has this badge (awarded on ${existingBadge.awardedAt})`,
      });
    }

    const badge = await prisma.studentBadge.create({
      data: {
        studentId: data.userId,
        badgeId: data.badgeDefinitionId,
        awardedBy: req.user!.sub,
        reason: data.reason,
        projectId: data.projectId,
        eventId: data.eventId,
        awardedByName: data.awardedByName,
      },
      include: {
        badge: true,
      },
    });

    // Auto-create badge award post (if enabled)
    try {
      await BadgePostService.createBadgeAwardPost(badge, req.user!, studentInfo);
    } catch (error) {
      console.error('Failed to create badge award post:', error);
      // Don't fail the badge creation if post creation fails
    }

    return reply.code(201).send({ badge });
  });

  // Protected: Export badge awards data (Faculty/Admin only)
  app.get("/v1/badges/export", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
      
      // Fetch all badge awards with badge definitions 
      const awards = await prisma.studentBadge.findMany({
        include: {
          badge: true,
        },
        orderBy: {
          awardedAt: 'desc',
        },
      });

      // Fetch student details from auth service for each unique student
      const studentIds = [...new Set(awards.map(award => award.studentId))];
      const studentDetails = new Map();

      for (const studentId of studentIds) {
        try {
          const userResponse = await axios.get(`${authServiceUrl}/v1/users/${studentId}`, {
            headers: {
              Authorization: req.headers.authorization,
            },
          });
          if (userResponse.data && userResponse.data.user) {
            studentDetails.set(studentId, userResponse.data.user);
          }
        } catch (error) {
          console.error(`Failed to fetch details for student ${studentId}:`, error);
        }
      }

      // Format export data
      const exportData = awards.map(award => {
        const studentInfo = studentDetails.get(award.studentId);
        console.log(`Export mapping for ${award.studentId}:`, studentInfo);
        return {
          badgeName: award.badge.name,
          studentName: studentInfo?.displayName || studentInfo?.name || 'Unknown',
          collegeMemberId: studentInfo?.collegeMemberId || 'N/A',
          department: studentInfo?.department || 'N/A',
          awardedAt: award.awardedAt,
          awardedByName: award.awardedByName || 'Unknown',
          reason: award.reason,
          badgeCategory: award.badge.category || 'N/A',
          badgeRarity: award.badge.rarity,
          projectName: award.projectId ? `Project-${award.projectId}` : 'N/A', // TODO: Fetch actual project name
          eventName: award.eventId ? `Event-${award.eventId}` : 'N/A', // TODO: Fetch actual event name
        };
      });

      return reply.send(exportData);
    } catch (error) {
      console.error('Export error:', error);
      return reply.code(500).send({
        error: 'Export failed',
        message: 'Failed to export badge data'
      });
    }
  });

  // Protected: Get user badges by ID
  app.get("/v1/badges/user/:userId", {
    preHandler: requireAuth,
    schema: {
      tags: ["badges"],
      params: z.object({
        userId: z.string().cuid(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };

    const badges = await prisma.studentBadge.findMany({
      where: { studentId: userId },
      include: {
        badge: true,
      },
      orderBy: { awardedAt: "desc" },
    });

    reply.code(200).send({ badges });
  });

  // Protected: Get recent badge awards (Faculty/Admin only)
  app.get("/v1/badges/recent", {
    preHandler: [requireAuth, requireRole(["FACULTY", "DEPT_ADMIN", "HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      querystring: z.object({
        limit: z.string().optional(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { limit } = req.query as { limit?: string };
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
    
    if (!req.user?.id) {
      return reply.code(401).send({ error: "User not authenticated" });
    }
    const userId = req.user.id;

    // Filter awards by the faculty member who awarded them
    const awards = await prisma.studentBadge.findMany({
      where: {
        awardedBy: userId, // Only show badges awarded by this faculty member
      },
      take: limitNum,
      orderBy: { awardedAt: "desc" },
      include: {
        badge: true,
      },
    });

    // Fetch student details for display names and college member IDs
    const studentIds = [...new Set(awards.map(award => award.studentId))];
    const studentDetails = new Map();

    for (const studentId of studentIds) {
      try {
        const userResponse = await axios.get(`${authServiceUrl}/v1/users/${studentId}`, {
          headers: {
            Authorization: req.headers.authorization,
          },
        });
        console.log(`Auth service response for student ${studentId}:`, userResponse.data);
        if (userResponse.data && userResponse.data.user) {
          studentDetails.set(studentId, userResponse.data.user);
        }
      } catch (error) {
        console.error(`Failed to fetch details for student ${studentId}:`, error);
      }
    }

    // Enhance awards with student details
    const enhancedAwards = awards.map(award => {
      const studentInfo = studentDetails.get(award.studentId);
      console.log(`Student ${award.studentId} details:`, studentInfo);
      return {
        ...award,
        studentName: studentInfo?.displayName || studentInfo?.name,
        collegeMemberId: studentInfo?.collegeMemberId,
      };
    });

    return reply.send({ awards: enhancedAwards });
  });

  // Get badge award counts
  app.get("/v1/badges/counts", {
    preHandler: [requireAuth],
    schema: {
      tags: ["badges"],
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const badgeDefinitions = await prisma.badgeDefinition.findMany({
      select: { id: true },
    });

    const counts: Record<string, number> = {};
    
    for (const badge of badgeDefinitions) {
      const count = await prisma.studentBadge.count({
        where: { badgeId: badge.id },
      });
      counts[badge.id] = count;
    }

    reply.code(200).send({ counts });
  });

  // Check event creation eligibility for a user
  app.get("/v1/badges/eligibility/:userId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["badges"],
      params: z.object({
        userId: z.string().cuid(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';

    try {
      // Get user's college info from auth service
      const userResponse = await axios.get(`${authServiceUrl}/v1/users/${userId}`, {
        headers: {
          Authorization: req.headers.authorization,
        },
      });
      
      const user = userResponse.data?.user;
      if (!user?.collegeId) {
        return reply.code(400).send({ 
          error: "User college information not found",
          canCreate: false,
          missing: []
        });
      }

      // Check cache first
      const cached = await prisma.badgeEligibilityCache.findUnique({
        where: { userId },
      });

      if (cached && cached.expiresAt > new Date()) {
        return reply.send({
          canCreate: cached.canCreate,
          badgeCount: cached.badgeCount,
          categories: cached.categories,
          lastChecked: cached.lastChecked,
        });
      }

      // Get badge policy for user's college
      const policy = await prisma.badgePolicy.findUnique({
        where: { collegeId: user.collegeId },
      });

      const requiredBadges = policy?.eventCreationRequired || 8;
      const requiredCategories = policy?.categoryDiversityMin || 4;

      // Get user's badges with categories
      const userBadges = await prisma.studentBadge.findMany({
        where: { studentId: userId },
        include: {
          badge: {
            select: { category: true, isActive: true },
          },
        },
      });

      const activeBadges = userBadges.filter(award => award.badge.isActive);
      const categories = [...new Set(activeBadges.map(award => award.badge.category).filter((cat): cat is string => Boolean(cat)))];
      
      const canCreate = activeBadges.length >= requiredBadges && categories.length >= requiredCategories;

      // Update cache
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      await prisma.badgeEligibilityCache.upsert({
        where: { userId },
        update: {
          canCreate,
          badgeCount: activeBadges.length,
          categories,
          lastChecked: new Date(),
          expiresAt,
        },
        create: {
          userId,
          canCreate,
          badgeCount: activeBadges.length,
          categories,
          expiresAt,
        },
      });

      return reply.send({
        canCreate,
        badgeCount: activeBadges.length,
        requiredBadges,
        categories,
        requiredCategories,
        lastChecked: new Date(),
      });

    } catch (error) {
      console.error('Badge eligibility check failed:', error);
      return reply.code(500).send({
        error: "Failed to check badge eligibility",
        canCreate: false,
      });
    }
  });

  // Manage badge policies (Admin only)
  app.post("/v1/badges/policies", {
    preHandler: [requireAuth, requireRole(["HEAD_ADMIN"])],
    schema: {
      tags: ["badges"],
      body: z.object({
        collegeId: z.string().cuid(),
        departmentId: z.string().optional(),
        eventCreationRequired: z.number().int().min(1).default(8),
        categoryDiversityMin: z.number().int().min(1).default(4),
      }),
      response: { 201: z.any() },
    },
  }, async (req, reply) => {
    const data = req.body as any;

    const policy = await prisma.badgePolicy.create({
      data,
    });

    return reply.code(201).send({ policy });
  });

  // Get badge policy for a college
  app.get("/v1/badges/policies/:collegeId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["badges"],
      params: z.object({
        collegeId: z.string().cuid(),
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { collegeId } = req.params as { collegeId: string };

    const policy = await prisma.badgePolicy.findUnique({
      where: { collegeId },
    });

    if (!policy) {
      // Return default policy
      return reply.send({
        policy: {
          collegeId,
          eventCreationRequired: 8,
          categoryDiversityMin: 4,
          isActive: true,
        }
      });
    }

    return reply.send({ policy });
  });

  // Create profile endpoint (called by auth service during user registration)
  app.post("/v1/profiles", {
    preHandler: [requireSystemAuth, requireSystemPermission('canCreateProfiles')],
    schema: {
      tags: ["profiles"],
      summary: "Create user profile (System endpoint)",
      description: "Creates a new user profile. Only accessible by authorized system services.",
      headers: z.object({
        'x-system-token': z.string().describe('System authentication token'),
        'x-service-id': z.string().describe('Calling service identifier')
      }),
      body: z.object({
        userId: z.string().cuid('Invalid user ID format'),
        collegeId: z.string().cuid('Invalid college ID format').optional(),
        department: z.string().max(100, 'Department name too long').optional(),
        year: z.number().int().min(1).max(6, 'Year must be between 1-6').optional(),
        bio: z.string().max(1000, 'Bio too long').optional(),
        skills: z.array(z.string().max(50, 'Skill name too long')).max(20, 'Too many skills').optional(),
        resumeUrl: z.string().url('Invalid resume URL').optional(),
        linkedIn: z.string().url('Invalid LinkedIn URL').optional(),
        github: z.string().url('Invalid GitHub URL').optional(),
        personalProjects: z.array(z.any()).max(10, 'Too many projects').optional(),
      }),
      response: { 
        201: z.object({
          success: z.boolean(),
          profile: z.object({
            id: z.string(),
            userId: z.string(),
            createdAt: z.string()
          })
        }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        409: errorResponseSchema
      },
    },
  }, async (req, reply) => {
    const { userId, collegeId, department, year, bio, skills, resumeUrl, linkedIn, github, personalProjects } = req.body as any;

    try {
      // Validate input data
      if (!userId) {
        return reply.code(400).send({ 
          success: false,
          message: "User ID is required" 
        });
      }

      // Check if profile already exists
      const existingProfile = await prisma.profile.findUnique({
        where: { userId }
      });

      if (existingProfile) {
        return reply.code(409).send({ 
          success: false,
          message: "Profile already exists for this user",
          details: { userId, existingProfileId: existingProfile.id }
        });
      }

      // Create new profile with transaction for data consistency
      const profile = await prisma.$transaction(async (tx) => {
        const newProfile = await tx.profile.create({
          data: {
            userId,
            bio: bio?.trim() || null,
            skills: skills || [],
            expertise: [], // Initialize empty expertise array
            resumeUrl: resumeUrl || null,
            linkedIn: linkedIn || null,
            github: github || null,
          },
          select: {
            id: true,
            userId: true,
            createdAt: true,
            bio: true,
            skills: true
          }
        });

        // Log profile creation for audit
        req.log.info({
          userId,
          profileId: newProfile.id,
          serviceId: (req as any).system?.serviceId,
          timestamp: new Date().toISOString()
        }, 'Profile created by system service');

        return newProfile;
      });

      return reply.code(201).send({ 
        success: true,
        profile: {
          id: profile.id,
          userId: profile.userId,
          createdAt: profile.createdAt.toISOString()
        }
      });

    } catch (error) {
      req.log.error({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        serviceId: (req as any).system?.serviceId
      }, 'Failed to create profile');

      // Handle specific database errors
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ 
            success: false,
            message: "Profile already exists for this user" 
          });
        }
      }

      return reply.code(500).send({ 
        success: false,
        message: "Failed to create profile",
        details: process.env.NODE_ENV === 'development' ? {
          error: error instanceof Error ? error.message : 'Unknown error'
        } : undefined
      });
    }
  });

  // ============================================================================
  // CRITICAL P0 ENDPOINTS FOR 10M+ USERS
  // ============================================================================

  // Protected: Profile Search & Directory (CRITICAL for 10M+ users)
  app.get("/v1/profiles/search", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      querystring: z.object({
        q: z.string().min(1).max(100).optional(), // Search query
        skills: z.string().optional(), // Comma-separated skills
        department: z.string().optional(),
        year: z.number().int().min(1).max(6).optional(),
        college: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(['name', 'createdAt', 'badges', 'projects']).default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc')
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { q, skills, department, year, college, limit, offset, sortBy, sortOrder } = req.query as any;
    
    try {
      // Build search conditions
      const whereConditions: any = {};
      const searchConditions: any[] = [];

      // Text search on name and bio
      if (q) {
        searchConditions.push({
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { bio: { contains: q, mode: 'insensitive' } }
          ]
        });
      }

      // Skills search (array contains)
      if (skills) {
        const skillArray = skills.split(',').map((s: string) => s.trim());
        searchConditions.push({
          skills: { hasSome: skillArray }
        });
      }

      // Combine all search conditions
      if (searchConditions.length > 0) {
        whereConditions.AND = searchConditions;
      }

      // Get user info to filter by college if needed
      const userInfo = await AuthServiceClient.getUser(req.user!.sub, req.headers.authorization || '');
      
      // Build sorting
      const orderBy: any = {};
      if (sortBy === 'name') {
        orderBy.name = sortOrder;
      } else if (sortBy === 'createdAt') {
        orderBy.createdAt = sortOrder;
      }

      // Execute search with pagination
      const [profiles, totalCount] = await Promise.all([
        prisma.profile.findMany({
          where: whereConditions,
          select: {
            id: true,
            userId: true,
            name: true,
            bio: true,
            skills: true,
            expertise: true,
            avatar: true,
            createdAt: true,
            _count: {
              select: {
                studentBadges: true,
                personalProjects: true,
                experiences: true
              }
            }
          },
          orderBy,
          take: limit,
          skip: offset
        }),
        prisma.profile.count({ where: whereConditions })
      ]);

      // Enhance with user data from auth service
      const enhancedProfiles = await Promise.all(
        profiles.map(async (profile) => {
          try {
            const userData = await AuthServiceClient.getUser(profile.userId, req.headers.authorization || '');
            return {
              ...profile,
              displayName: userData?.displayName || profile.name,
              avatarUrl: userData?.avatarUrl || profile.avatar,
              department: userData?.department,
              year: userData?.year,
              collegeId: userData?.collegeId,
              badgeCount: profile._count.studentBadges,
              projectCount: profile._count.personalProjects,
              experienceCount: profile._count.experiences
            };
          } catch {
            // If auth service fails, return profile data only
            return {
              ...profile,
              displayName: profile.name,
              avatarUrl: profile.avatar,
              badgeCount: profile._count.studentBadges,
              projectCount: profile._count.personalProjects,
              experienceCount: profile._count.experiences
            };
          }
        })
      );

      // Filter by department/year/college if specified
      let filteredProfiles = enhancedProfiles;
      if (department || year || college) {
        filteredProfiles = enhancedProfiles.filter(profile => {
          if (department && 'department' in profile && profile.department !== department) return false;
          if (year && 'year' in profile && profile.year !== year) return false;
          if (college && 'collegeId' in profile && profile.collegeId !== college) return false;
          return true;
        });
      }

      const responseTime = Date.now() - startTime;
      
      req.log.info({
        query: { q, skills, department, year, college },
        resultCount: filteredProfiles.length,
        totalCount,
        responseTime,
        userId: req.user!.sub
      }, 'Profile search completed');

      return reply.send({
        success: true,
        profiles: filteredProfiles,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount
        },
        meta: {
          responseTime,
          query: { q, skills, department, year, college }
        }
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      req.log.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        query: { q, skills, department, year, college },
        responseTime,
        userId: req.user!.sub
      }, 'Profile search failed');

      return reply.code(500).send({
        success: false,
        message: 'Search temporarily unavailable',
        code: 'SEARCH_ERROR'
      });
    }
  });

  // Protected: Profile Directory (Paginated list for browsing)
  app.get("/v1/profiles/directory", {
    preHandler: requireAuth,
    schema: {
      tags: ["profiles"],
      querystring: z.object({
        department: z.string().optional(),
        year: z.number().int().min(1).max(6).optional(),
        role: z.enum(['STUDENT', 'FACULTY']).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(['name', 'createdAt', 'badges']).default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc')
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { department, year, role, limit, offset, sortBy, sortOrder } = req.query as any;
    
    try {
      // Get user's college for filtering
      const userInfo = await AuthServiceClient.getUser(req.user!.sub, req.headers.authorization || '');
      
      if (!userInfo?.collegeId) {
        return reply.code(400).send({
          success: false,
          message: 'User college information not found'
        });
      }

      // Build sorting
      const orderBy: any = {};
      if (sortBy === 'name') {
        orderBy.name = sortOrder;
      } else if (sortBy === 'createdAt') {
        orderBy.createdAt = sortOrder;
      }

      // Get profiles from same college
      const [profiles, totalCount] = await Promise.all([
        prisma.profile.findMany({
          select: {
            id: true,
            userId: true,
            name: true,
            bio: true,
            skills: true,
            expertise: true,
            avatar: true,
            createdAt: true,
            _count: {
              select: {
                studentBadges: true,
                personalProjects: true,
                experiences: true
              }
            }
          },
          orderBy,
          take: limit,
          skip: offset
        }),
        prisma.profile.count()
      ]);

      // Enhance with user data and filter by college/department/year/role
      const enhancedProfiles = await Promise.all(
        profiles.map(async (profile) => {
          try {
            const userData = await AuthServiceClient.getUser(profile.userId, req.headers.authorization || '');
            
            // Filter by college (same college only)
            if (userData?.collegeId !== userInfo.collegeId) return null;
            
            // Apply additional filters
            if (department && userData?.department !== department) return null;
            if (year && userData?.year !== year) return null;
            if (role && !userData?.roles?.includes(role)) return null;

            return {
              id: profile.id,
              userId: profile.userId,
              name: profile.name || userData?.displayName || '',
              displayName: userData?.displayName || profile.name || '',
              bio: profile.bio || '',
              skills: profile.skills || [],
              expertise: profile.expertise || [],
              avatarUrl: userData?.avatarUrl || profile.avatar || '',
              department: userData?.department || '',
              year: userData?.year,
              roles: userData?.roles || [],
              badgeCount: profile._count.studentBadges,
              projectCount: profile._count.personalProjects,
              experienceCount: profile._count.experiences,
              joinedAt: userData?.createdAt || profile.createdAt
            };
          } catch {
            return null; // Skip profiles where auth service fails
          }
        })
      );

      // Filter out null results
      const validProfiles = enhancedProfiles.filter(p => p !== null);
      
      const responseTime = Date.now() - startTime;
      
      req.log.info({
        filters: { department, year, role },
        resultCount: validProfiles.length,
        totalCount,
        responseTime,
        userId: req.user!.sub,
        collegeId: userInfo.collegeId
      }, 'Profile directory loaded');

      return reply.send({
        success: true,
        profiles: validProfiles,
        pagination: {
          total: validProfiles.length,
          limit,
          offset,
          hasMore: offset + limit < validProfiles.length
        },
        meta: {
          responseTime,
          collegeId: userInfo.collegeId,
          filters: { department, year, role }
        }
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      req.log.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        filters: { department, year, role },
        responseTime,
        userId: req.user!.sub
      }, 'Profile directory failed');

      return reply.code(500).send({
        success: false,
        message: 'Directory temporarily unavailable',
        code: 'DIRECTORY_ERROR'
      });
    }
  });

  // Protected: Profile Statistics (for analytics)
  app.get("/v1/profiles/stats", {
    preHandler: [requireAuth, requireRole(['HEAD_ADMIN', 'DEPT_ADMIN'])],
    schema: {
      tags: ["profiles"],
      querystring: z.object({
        department: z.string().optional(),
        timeframe: z.enum(['week', 'month', 'year']).default('month')
      }),
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const startTime = Date.now();
    const { department, timeframe } = req.query as any;
    
    try {
      // Get user's college for filtering
      const userInfo = await AuthServiceClient.getUser(req.user!.sub, req.headers.authorization || '');
      
      if (!userInfo?.collegeId) {
        return reply.code(403).send({
          success: false,
          message: 'Access denied: College information required'
        });
      }

      // Calculate date range
      const now = new Date();
      const timeRanges = {
        week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        year: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      };
      const startDate = timeRanges[timeframe as keyof typeof timeRanges];

      // Get profile statistics
      const [
        totalProfiles,
        newProfiles,
        profilesWithSkills,
        profilesWithBio,
        avgBadgesPerUser,
        avgProjectsPerUser
      ] = await Promise.all([
        prisma.profile.count(),
        prisma.profile.count({
          where: { createdAt: { gte: startDate } }
        }),
        prisma.profile.count({
          where: { 
            skills: { 
              isEmpty: false 
            } 
          }
        }),
        prisma.profile.count({
          where: { 
            AND: [
              { bio: { not: null } },
              { bio: { not: { equals: '' } } }
            ]
          }
        }),
        prisma.studentBadge.groupBy({
          by: ['studentId'],
          _count: { studentId: true }
        }),
        prisma.personalProject.groupBy({
          by: ['userId'],
          _count: { userId: true }
        })
      ]);

      // Get skill distribution
      const skillStats = await prisma.$queryRaw`
        SELECT 
          unnest(skills) as skill,
          COUNT(*) as count
        FROM "Profile" 
        WHERE array_length(skills, 1) > 0
        GROUP BY skill
        ORDER BY count DESC
        LIMIT 20
      `;

      const responseTime = Date.now() - startTime;
      
      req.log.info({
        stats: { totalProfiles, newProfiles },
        responseTime,
        userId: req.user!.sub,
        collegeId: userInfo.collegeId
      }, 'Profile statistics generated');

      return reply.send({
        success: true,
        stats: {
          overview: {
            totalProfiles,
            newProfiles,
            profilesWithSkills,
            profilesWithBio,
            completionRate: Math.round((profilesWithBio / totalProfiles) * 100)
          },
          engagement: {
            avgBadgesPerUser: avgBadgesPerUser.length > 0 ? Math.round((avgBadgesPerUser.reduce((sum, item) => sum + item._count.studentId, 0) / avgBadgesPerUser.length) * 100) / 100 : 0,
            avgProjectsPerUser: avgProjectsPerUser.length > 0 ? Math.round((avgProjectsPerUser.reduce((sum, item) => sum + item._count.userId, 0) / avgProjectsPerUser.length) * 100) / 100 : 0
          },
          skills: {
            topSkills: skillStats,
            totalUniqueSkills: (skillStats as any[]).length
          }
        },
        meta: {
          timeframe,
          startDate,
          endDate: now,
          responseTime,
          collegeId: userInfo.collegeId
        }
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      req.log.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime,
        userId: req.user!.sub
      }, 'Profile statistics failed');

      return reply.code(500).send({
        success: false,
        message: 'Statistics temporarily unavailable',
        code: 'STATS_ERROR'
      });
    }
  });

}
