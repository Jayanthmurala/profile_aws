// Admin permission levels for profile service
export type AdminRole = "HEAD_ADMIN" | "DEPT_ADMIN" | "PLACEMENTS_ADMIN";

// Admin context for requests
export interface AdminContext {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  collegeId: string;
  department?: string;
  ipAddress?: string;
  userAgent?: string;
}

// Profile management interfaces
export interface ProfileUpdateRequest {
  displayName?: string;
  avatarUrl?: string;
  name?: string;
  bio?: string;
  skills?: string[];
  expertise?: string[];
  linkedIn?: string;
  github?: string;
  twitter?: string;
  resumeUrl?: string;
  contactInfo?: string;
  phoneNumber?: string;
  alternateEmail?: string;
  year?: number;
  department?: string;
}

export interface BulkProfileOperation {
  action: "UPDATE" | "APPROVE" | "REJECT" | "REQUIRE_COMPLETION";
  profiles: Array<{ userId: string; data?: ProfileUpdateRequest; reason?: string }>;
  preview?: boolean;
}

// Badge management interfaces
export interface BadgeDefinitionRequest {
  name: string;
  description: string;
  icon?: string;
  color?: string;
  category?: string;
  criteria?: string;
  rarity: "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
  points?: number;
  isActive?: boolean;
}

export interface BadgeAwardRequest {
  badgeDefinitionId: string;
  userId: string;
  reason: string;
  projectId?: string;
  eventId?: string;
  awardedByName?: string;
}

export interface BulkBadgeOperation {
  action: "AWARD" | "REVOKE";
  awards: Array<{
    userId: string;
    badgeDefinitionId: string;
    reason: string;
    projectId?: string;
    eventId?: string;
  }>;
  preview?: boolean;
}

// Profile moderation interfaces
export interface ModerationRequest {
  profileId: string;
  userId: string;
  contentType: "BIO" | "PROJECT" | "PUBLICATION" | "EXPERIENCE" | "PROFILE";
  contentId?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string;
}

export interface ProfileRequirementsConfig {
  collegeId: string;
  requireBio: boolean;
  requireSkills: boolean;
  minSkillCount: number;
  requireProjects: boolean;
  minProjectCount: number;
  requireExperience: boolean;
  requireResume: boolean;
  requireSocialLinks: boolean;
  enforceForNetwork: boolean;
  enforceForEvents: boolean;
  enforceForProjects: boolean;
  isActive: boolean;
}

// Analytics interfaces
export interface ProfileAnalytics {
  totalProfiles: number;
  completionRates: {
    overall: number;
    byDepartment: Record<string, number>;
    byYear: Record<number, number>;
  };
  skillDistribution: Array<{
    skill: string;
    count: number;
    departments: string[];
  }>;
  badgeStatistics: {
    totalBadges: number;
    badgesByCategory: Record<string, number>;
    topBadgeHolders: Array<{
      userId: string;
      displayName: string;
      badgeCount: number;
      categories: string[];
    }>;
  };
  projectStatistics: {
    totalProjects: number;
    projectsByDepartment: Record<string, number>;
    averageProjectsPerStudent: number;
  };
  publicationStatistics: {
    totalPublications: number;
    publicationsByYear: Record<number, number>;
    publicationsByDepartment: Record<string, number>;
  };
}

export interface SkillTrendAnalysis {
  trendingSkills: Array<{
    skill: string;
    growth: number;
    industryRelevance: number;
    placementDemand: number;
    recommendedBadges: string[];
  }>;
  skillGaps: Array<{
    department: string;
    missingSkills: string[];
    industryDemand: number;
    recommendedActions: string[];
  }>;
  industryAlignment: {
    score: number;
    recommendations: string[];
    skillMapping: Record<string, string[]>;
  };
}

export interface PlacementReadinessReport {
  students: Array<{
    userId: string;
    displayName: string;
    department: string;
    year: number;
    profileCompleteness: number;
    skillCount: number;
    projectCount: number;
    badgeCount: number;
    placementScore: number;
    recommendations: string[];
  }>;
  departmentSummary: Record<string, {
    totalStudents: number;
    readyStudents: number;
    averageScore: number;
    topSkills: string[];
    recommendations: string[];
  }>;
}

// Filtering and pagination
export interface ProfileFilters {
  departments?: string[];
  years?: number[];
  skills?: string[];
  badges?: string[];
  completionStatus?: "COMPLETE" | "INCOMPLETE" | "PENDING_APPROVAL";
  hasProjects?: boolean;
  hasPublications?: boolean;
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface BadgeFilters {
  categories?: string[];
  rarity?: string[];
  isActive?: boolean;
  collegeSpecific?: boolean;
  awardedBy?: string;
  awardedAfter?: Date;
  awardedBefore?: Date;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// Audit log types
export type ProfileAuditAction = 
  | "LOGIN" | "LOGOUT"
  | "CREATE_PROFILE" | "UPDATE_PROFILE" | "DELETE_PROFILE"
  | "CREATE_BADGE" | "UPDATE_BADGE" | "DELETE_BADGE" 
  | "AWARD_BADGE" | "REVOKE_BADGE"
  | "CREATE_PROJECT" | "UPDATE_PROJECT" | "DELETE_PROJECT"
  | "CREATE_PUBLICATION" | "UPDATE_PUBLICATION" | "DELETE_PUBLICATION"
  | "APPROVE_CONTENT" | "REJECT_CONTENT"
  | "UPDATE_REQUIREMENTS" | "BULK_OPERATION"
  | "EXPORT_DATA" | "GENERATE_REPORT";

export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: ProfileAuditAction;
  targetType: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  collegeId: string;
  success: boolean;
  errorMessage?: string;
  createdAt: Date;
}

// Response interfaces
export interface AdminResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface BulkOperationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    data?: any;
  }>;
  preview?: boolean;
}

// Integration interfaces
export interface ServiceIntegration {
  serviceName: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  data?: any;
}

export interface PlacementServiceIntegration {
  checkJobEligibility: (userId: string, jobId: string) => Promise<boolean>;
  getSkillDemand: (skills: string[]) => Promise<Record<string, number>>;
  updateCandidateProfile: (userId: string, profileData: any) => Promise<void>;
}

export interface ProjectServiceIntegration {
  awardProjectBadge: (userId: string, projectId: string, badgeType: string) => Promise<void>;
  getProjectAchievements: (userId: string) => Promise<any[]>;
  checkProjectEligibility: (userId: string, projectId: string) => Promise<boolean>;
}

export interface EventServiceIntegration {
  checkEventEligibility: (userId: string, eventId: string) => Promise<boolean>;
  awardEventBadge: (userId: string, eventId: string, badgeType: string) => Promise<void>;
  getEventParticipation: (userId: string) => Promise<any[]>;
}

// Admin limits and constraints
export interface AdminLimits {
  MAX_BULK_OPERATION_SIZE: number;
  MAX_BADGE_AWARDS_PER_DAY: number;
  AUDIT_LOG_RETENTION_DAYS: number;
  PROFILE_MODERATION_TIMEOUT_HOURS: number;
}

export const ADMIN_LIMITS: AdminLimits = {
  MAX_BULK_OPERATION_SIZE: 500,
  MAX_BADGE_AWARDS_PER_DAY: 100,
  AUDIT_LOG_RETENTION_DAYS: 730, // 2 years
  PROFILE_MODERATION_TIMEOUT_HOURS: 72, // 3 days
};

// Permission matrix
export interface AdminPermissions {
  canEditProfiles: boolean;
  canCreateBadges: boolean;
  canAwardBadges: boolean;
  canRevokeBadges: boolean;
  canModerateContent: boolean;
  canSetRequirements: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  canBulkOperations: boolean;
  scope: "COLLEGE" | "DEPARTMENT" | "PLACEMENT";
}

// Badge policy interfaces
export interface BadgePolicyConfig {
  collegeId: string;
  departmentId?: string;
  eventCreationRequired: number;
  categoryDiversityMin: number;
  isActive: boolean;
}

// Industry trend interfaces
export interface IndustryTrend {
  skill: string;
  demandScore: number;
  growthRate: number;
  salaryRange: {
    min: number;
    max: number;
    currency: string;
  };
  relatedSkills: string[];
  recommendedCertifications: string[];
  jobTitles: string[];
}
