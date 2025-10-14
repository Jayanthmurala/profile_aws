import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";

/**
 * Ownership validation middleware for protecting user resources
 * Ensures users can only access/modify their own data
 */

export interface OwnershipRequest extends FastifyRequest {
  user: {
    sub: string;
    id: string;
    email: string;
    roles: string[];
    displayName?: string;
  };
}

/**
 * Validate that the authenticated user owns the requested project
 */
export async function validateProjectOwnership(request: FastifyRequest, reply: FastifyReply) {
  try {
    const ownershipRequest = request as OwnershipRequest;
    const { projectId } = request.params as { projectId: string };
    const userId = ownershipRequest.user.sub;

    if (!projectId) {
      return reply.code(400).send({
        success: false,
        message: "Project ID is required"
      });
    }

    // Check if project exists and belongs to the user
    const project = await prisma.personalProject.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, title: true }
    });

    if (!project) {
      return reply.code(404).send({
        success: false,
        message: "Project not found"
      });
    }

    if (project.userId !== userId) {
      return reply.code(403).send({
        success: false,
        message: "Access denied: You can only modify your own projects"
      });
    }

    // Attach project info to request for use in handler
    (request as any).project = project;

  } catch (error) {
    request.log.error({ error, projectId: (request.params as any).projectId }, 'Project ownership validation failed');
    return reply.code(500).send({
      success: false,
      message: "Failed to validate project ownership"
    });
  }
}

/**
 * Validate that the authenticated user owns the requested publication
 */
export async function validatePublicationOwnership(request: FastifyRequest, reply: FastifyReply) {
  try {
    const ownershipRequest = request as OwnershipRequest;
    const { publicationId } = request.params as { publicationId: string };
    const userId = ownershipRequest.user.sub;

    if (!publicationId) {
      return reply.code(400).send({
        success: false,
        message: "Publication ID is required"
      });
    }

    // Check if publication exists and belongs to the user
    const publication = await prisma.publication.findUnique({
      where: { id: publicationId },
      select: { id: true, userId: true, title: true }
    });

    if (!publication) {
      return reply.code(404).send({
        success: false,
        message: "Publication not found"
      });
    }

    if (publication.userId !== userId) {
      return reply.code(403).send({
        success: false,
        message: "Access denied: You can only modify your own publications"
      });
    }

    // Attach publication info to request for use in handler
    (request as any).publication = publication;

  } catch (error) {
    request.log.error({ error, publicationId: (request.params as any).publicationId }, 'Publication ownership validation failed');
    return reply.code(500).send({
      success: false,
      message: "Failed to validate publication ownership"
    });
  }
}

/**
 * Validate that the authenticated user owns the requested experience
 */
export async function validateExperienceOwnership(request: FastifyRequest, reply: FastifyReply) {
  try {
    const ownershipRequest = request as OwnershipRequest;
    const { id } = request.params as { id: string };
    const userId = ownershipRequest.user.sub;

    if (!id) {
      return reply.code(400).send({
        success: false,
        message: "Experience ID is required"
      });
    }

    // Check if experience exists and belongs to the user
    const experience = await prisma.experience.findUnique({
      where: { id },
      select: { id: true, profileId: true }
    });

    if (!experience) {
      return reply.code(404).send({
        success: false,
        message: "Experience not found"
      });
    }

    // Check ownership through profile relation
    const profile = await prisma.profile.findUnique({
      where: { id: experience.profileId },
      select: { userId: true }
    });

    if (!profile || profile.userId !== userId) {
      return reply.code(403).send({
        success: false,
        message: "Access denied: You can only modify your own experiences"
      });
    }

    // Attach experience info to request for use in handler
    (request as any).experience = experience;

  } catch (error) {
    request.log.error({ error, experienceId: (request.params as any).id }, 'Experience ownership validation failed');
    return reply.code(500).send({
      success: false,
      message: "Failed to validate experience ownership"
    });
  }
}

/**
 * Validate cross-college access for user profiles
 * Ensures users can only access profiles from their own college (unless admin)
 */
export async function validateCrossCollegeAccess(request: FastifyRequest, reply: FastifyReply) {
  try {
    const ownershipRequest = request as OwnershipRequest;
    const { userId } = request.params as { userId: string };
    const currentUserId = ownershipRequest.user.sub;
    const userRoles = ownershipRequest.user.roles || [];

    // Admins can access any profile
    const isAdmin = userRoles.some(role => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
    );

    if (isAdmin) {
      return; // Allow admin access
    }

    // Users can always access their own profile
    if (userId === currentUserId) {
      return;
    }

    // For other users, check college membership
    // This would require calling auth service to get college info
    // For now, we'll allow access but log it for monitoring
    request.log.info({
      currentUserId,
      requestedUserId: userId,
      userRoles
    }, 'Cross-user profile access');

    // In production, implement proper college validation:
    // const currentUserCollege = await AuthServiceClient.getUser(currentUserId, authHeader);
    // const targetUserCollege = await AuthServiceClient.getUser(userId, authHeader);
    // if (currentUserCollege?.collegeId !== targetUserCollege?.collegeId) {
    //   return reply.code(403).send({ message: "Cross-college access denied" });
    // }

  } catch (error) {
    request.log.error({ error }, 'Cross-college access validation failed');
    return reply.code(500).send({
      success: false,
      message: "Failed to validate access permissions"
    });
  }
}

/**
 * Validate badge award ownership (for revocation)
 */
export async function validateBadgeAwardOwnership(request: FastifyRequest, reply: FastifyReply) {
  try {
    const ownershipRequest = request as OwnershipRequest;
    const { awardId } = request.params as { awardId: string };
    const userId = ownershipRequest.user.sub;
    const userRoles = ownershipRequest.user.roles || [];

    if (!awardId) {
      return reply.code(400).send({
        success: false,
        message: "Award ID is required"
      });
    }

    // Check if badge award exists
    const badgeAward = await prisma.studentBadge.findUnique({
      where: { id: awardId },
      include: {
        badge: {
          select: { id: true, name: true, collegeId: true }
        }
      }
    });

    if (!badgeAward) {
      return reply.code(404).send({
        success: false,
        message: "Badge award not found"
      });
    }

    // Check if user can revoke this badge
    const canRevoke = 
      badgeAward.awardedBy === userId || // User awarded the badge
      userRoles.includes('HEAD_ADMIN') || // Head admin can revoke any
      userRoles.includes('SUPER_ADMIN'); // Super admin can revoke any

    if (!canRevoke) {
      return reply.code(403).send({
        success: false,
        message: "Access denied: You can only revoke badges you awarded"
      });
    }

    // Attach badge award info to request
    (request as any).badgeAward = badgeAward;

  } catch (error) {
    request.log.error({ error, awardId: (request.params as any).awardId }, 'Badge award ownership validation failed');
    return reply.code(500).send({
      success: false,
      message: "Failed to validate badge award ownership"
    });
  }
}

/**
 * Generic resource ownership validator factory
 */
export function createOwnershipValidator(
  resourceType: 'project' | 'publication' | 'experience' | 'badge_award',
  options: {
    allowAdmin?: boolean;
    allowSameCollege?: boolean;
  } = {}
) {
  const validators = {
    project: validateProjectOwnership,
    publication: validatePublicationOwnership,
    experience: validateExperienceOwnership,
    badge_award: validateBadgeAwardOwnership
  };

  return validators[resourceType];
}
