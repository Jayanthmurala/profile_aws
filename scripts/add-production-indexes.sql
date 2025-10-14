-- Critical Production Indexes for 10M+ Users
-- Profile Service Database Optimization

-- Profile table indexes (most critical)
CREATE INDEX IF NOT EXISTS idx_profile_userid ON "Profile"("userId");
CREATE INDEX IF NOT EXISTS idx_profile_skills_gin ON "Profile" USING GIN("skills");
CREATE INDEX IF NOT EXISTS idx_profile_expertise_gin ON "Profile" USING GIN("expertise");
CREATE INDEX IF NOT EXISTS idx_profile_created_at ON "Profile"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_profile_updated_at ON "Profile"("updatedAt" DESC);

-- Enable trigram extension for text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- StudentBadge indexes for badge queries
CREATE INDEX IF NOT EXISTS idx_studentbadge_userid ON "StudentBadge"("userId");
CREATE INDEX IF NOT EXISTS idx_studentbadge_badgeid ON "StudentBadge"("badgeId");
CREATE INDEX IF NOT EXISTS idx_studentbadge_awarded_at ON "StudentBadge"("awardedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_studentbadge_user_badge ON "StudentBadge"("userId", "badgeId");

-- BadgeDefinition indexes
CREATE INDEX IF NOT EXISTS idx_badgedefinition_collegeid ON "BadgeDefinition"("collegeId");
CREATE INDEX IF NOT EXISTS idx_badgedefinition_category ON "BadgeDefinition"("category");
CREATE INDEX IF NOT EXISTS idx_badgedefinition_rarity ON "BadgeDefinition"("rarity");
CREATE INDEX IF NOT EXISTS idx_badgedefinition_active ON "BadgeDefinition"("isActive");

-- Experience indexes for profile queries
CREATE INDEX IF NOT EXISTS idx_experience_userid ON "Experience"("userId");
CREATE INDEX IF NOT EXISTS idx_experience_profileid ON "Experience"("profileId");
CREATE INDEX IF NOT EXISTS idx_experience_dates ON "Experience"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS idx_experience_current ON "Experience"("isCurrent") WHERE "isCurrent" = true;
CREATE INDEX IF NOT EXISTS idx_experience_type ON "Experience"("type");

-- PersonalProject indexes
CREATE INDEX IF NOT EXISTS idx_personalproject_userid ON "PersonalProject"("userId");
CREATE INDEX IF NOT EXISTS idx_personalproject_profileid ON "PersonalProject"("profileId");
CREATE INDEX IF NOT EXISTS idx_personalproject_created_at ON "PersonalProject"("createdAt" DESC);

-- Publication indexes (for faculty)
CREATE INDEX IF NOT EXISTS idx_publication_userid ON "Publication"("userId");
CREATE INDEX IF NOT EXISTS idx_publication_profileid ON "Publication"("profileId");
CREATE INDEX IF NOT EXISTS idx_publication_year ON "Publication"("year" DESC);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_studentbadge_user_awarded ON "StudentBadge"("userId", "awardedAt" DESC);

-- Partial indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_profile_has_skills ON "Profile"("userId") WHERE array_length("skills", 1) > 0;
CREATE INDEX IF NOT EXISTS idx_profile_has_bio ON "Profile"("userId") WHERE "bio" IS NOT NULL AND "bio" != '';

-- Add statistics for query planner optimization
ANALYZE "Profile";
ANALYZE "StudentBadge";
ANALYZE "BadgeDefinition";
ANALYZE "Experience";
ANALYZE "PersonalProject";
ANALYZE "Publication";

-- Create materialized view for profile search (optional for very high scale)
CREATE MATERIALIZED VIEW IF NOT EXISTS profile_search_mv AS
SELECT 
    p."userId",
    p."name",
    p."bio",
    p."skills",
    p."expertise",
    p."createdAt",
    COUNT(sb."id") as badge_count,
    COUNT(pp."id") as project_count,
    COUNT(e."id") as experience_count
FROM "Profile" p
LEFT JOIN "StudentBadge" sb ON p."userId" = sb."userId"
LEFT JOIN "PersonalProject" pp ON p."id" = pp."profileId"
LEFT JOIN "Experience" e ON p."id" = e."profileId"
GROUP BY p."userId", p."name", p."bio", p."skills", p."expertise", p."createdAt";

-- Index the materialized view
CREATE INDEX IF NOT EXISTS idx_profile_search_mv_userid ON profile_search_mv("userId");
CREATE INDEX IF NOT EXISTS idx_profile_search_mv_name ON profile_search_mv USING GIN("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profile_search_mv_skills ON profile_search_mv USING GIN("skills");

-- Refresh the materialized view (should be done periodically)
REFRESH MATERIALIZED VIEW profile_search_mv;
