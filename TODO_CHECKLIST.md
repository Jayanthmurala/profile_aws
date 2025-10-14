# Profile Service - Production Readiness TODO Checklist

## 🔴 P0 - CRITICAL (Must Fix Before Deploy)

### TypeScript Compilation Errors (22 errors)
- [ ] **Fix Admin Rate Limiting Async Issues** (`src/admin/middleware/rateLimiting.ts:286-323`)
  ```typescript
  // BEFORE (missing await):
  reply.header('X-RateLimit-Remaining', result.remaining);
  
  // AFTER (add await):
  const result = await rateLimiter.checkLimit(key);
  reply.header('X-RateLimit-Remaining', result.remaining);
  ```

- [ ] **Fix Prisma Aggregation Query** (`src/admin/services/AdminBadgeService.ts:698`)
  ```typescript
  // BEFORE (invalid _sum):
  _sum: { badge: { points: true } }
  
  // AFTER (remove invalid aggregation):
  // Use separate query for points calculation
  ```

- [ ] **Remove Invalid Fastify Hooks** (`src/middleware/rateLimit.ts:57`)
  ```typescript
  // BEFORE (invalid addHook on reply):
  reply.addHook('onSend', async (request, reply, payload) => {
  
  // AFTER (use app-level hooks or remove):
  // Move to app.addHook in main server setup
  ```

- [ ] **Fix Profile Route Type Issues** (`src/routes/profile.routes.ts:229,2746-3047`)
  ```typescript
  // Fix college name access
  collegeName = college?.name || null; // Add proper typing
  
  // Fix profile filtering with proper type guards
  if (department && 'department' in profile && profile.department !== department) return false;
  
  // Fix timeframe indexing
  const startDate = timeRanges[timeframe as keyof typeof timeRanges];
  
  // Remove invalid Prisma queries
  // Replace { not: { equals: [] } } with proper array filtering
  // Remove _avg aggregations that don't exist
  ```

### Environment Configuration
- [ ] **Fix JWT Issuer Typo** (`.env.example` line 8)
  ```bash
  # BEFORE:
  AUTH_JWT_ISSUER=nexus  -auth
  
  # AFTER:
  AUTH_JWT_ISSUER=nexus-auth
  ```

- [ ] **Create Production .env File**
  ```bash
  cp .env.example .env
  # Update with production values:
  # - DATABASE_URL (production database)
  # - REDIS_URL (production Redis)
  # - SYSTEM_SECRET (strong random secret)
  # - SYSTEM_JWT_SECRET (strong random secret)
  ```

### Build Verification
- [ ] **Verify TypeScript Build**
  ```bash
  npm run build
  # Must complete without errors
  # Verify dist/ contains all required files
  ```

- [ ] **Test Docker Build**
  ```bash
  docker build -t nexus-profile-service:test .
  # Must complete successfully
  ```

## 🟡 P1 - HIGH (Deploy Week 1)

### Security Hardening
- [ ] **Replace Default Secrets**
  ```bash
  # Generate strong secrets:
  SYSTEM_SECRET=$(openssl rand -hex 32)
  SYSTEM_JWT_SECRET=$(openssl rand -hex 32)
  ```

- [ ] **Configure Production CORS**
  ```typescript
  // Update CORS origins in src/index.ts
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : true
  ```

- [ ] **Add Request Timeouts**
  ```typescript
  // Add to Fastify config
  requestTimeout: 30000, // 30 seconds
  keepAliveTimeout: 5000
  ```

### Performance Optimization
- [ ] **Split Large Route Files**
  - Break `profile.routes.ts` (98KB) into smaller modules:
    - `profile-crud.routes.ts` - Basic CRUD operations
    - `profile-search.routes.ts` - Search and directory
    - `profile-badges.routes.ts` - Badge operations
    - `profile-analytics.routes.ts` - Statistics and analytics

- [ ] **Add Memory Limits**
  ```typescript
  // Add to Fastify config
  bodyLimit: 1048576, // 1MB
  // Add memory monitoring alerts
  ```

- [ ] **Optimize Complex Queries**
  - Review N+1 patterns in profile aggregation
  - Add database query analysis logging
  - Optimize badge statistics queries

### Database & Migration
- [ ] **Automate Migration Process**
  ```bash
  # Create migration automation script
  scripts/migrate-production.sh
  ```

- [ ] **Add Backup Strategy**
  - Configure automated PostgreSQL backups
  - Test restore procedures
  - Document backup retention policy

## 🟢 P2 - MEDIUM (Deploy Month 1)

### Testing & Quality Assurance
- [ ] **Add Comprehensive Test Suite**
  ```bash
  # Install testing dependencies
  npm install --save-dev jest @types/jest supertest
  
  # Create test structure:
  tests/
  ├── unit/
  ├── integration/
  └── load/
  ```

- [ ] **Add Test Coverage**
  - Unit tests for all services and utilities
  - Integration tests for API endpoints
  - Load tests for 10M+ user scenarios

- [ ] **Add API Documentation**
  ```bash
  # Generate OpenAPI docs
  npm run docs:generate
  ```

### Monitoring & Observability
- [ ] **Add Prometheus Metrics**
  ```typescript
  // Install prom-client
  import prometheus from 'prom-client';
  
  // Add custom metrics:
  // - Request duration histogram
  // - Database query duration
  // - Cache hit/miss rates
  // - Circuit breaker states
  ```

- [ ] **Implement Distributed Tracing**
  ```bash
  # Add OpenTelemetry
  npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node
  ```

- [ ] **Add Alerting Rules**
  - High error rates (>5%)
  - Slow response times (>2s)
  - Database connection failures
  - Memory usage >80%
  - Circuit breaker trips

### Infrastructure
- [ ] **Add Kubernetes Manifests**
  ```yaml
  # k8s/
  ├── deployment.yaml
  ├── service.yaml
  ├── configmap.yaml
  ├── secret.yaml
  └── hpa.yaml
  ```

- [ ] **Configure Auto-scaling**
  - Horizontal Pod Autoscaler (HPA)
  - Vertical Pod Autoscaler (VPA)
  - Database connection pool scaling

## 🔵 P3 - LOW (Future Iterations)

### Code Quality & Maintainability
- [ ] **Refactor Monolithic Files**
  - Split admin routes into separate modules
  - Extract common utilities
  - Improve type definitions

- [ ] **Add Code Quality Tools**
  ```bash
  # ESLint, Prettier, Husky
  npm install --save-dev eslint prettier husky lint-staged
  ```

- [ ] **Implement Code Coverage Reporting**
  ```bash
  # SonarQube or Codecov integration
  npm run test:coverage
  ```

### Advanced Features
- [ ] **Add GraphQL Support**
  - Consider GraphQL for complex queries
  - Implement DataLoader for N+1 prevention

- [ ] **Implement Event Sourcing**
  - For audit trails and profile history
  - Badge award event streams

- [ ] **Add Multi-region Support**
  - Database read replicas
  - Redis clustering
  - CDN integration

## Verification Commands

### P0 Verification
```bash
# 1. TypeScript compilation
npm run build
echo "✅ Build successful" || echo "❌ Build failed"

# 2. Docker build
docker build -t nexus-profile-service:test .
echo "✅ Docker build successful" || echo "❌ Docker build failed"

# 3. Service startup
docker run --rm -d --name test-profile --env-file .env nexus-profile-service:test
sleep 10
curl -f http://localhost:4002/health
docker stop test-profile
echo "✅ Service starts and responds" || echo "❌ Service startup failed"
```

### P1 Verification
```bash
# Security check
grep -r "default-system-secret" .env && echo "❌ Default secrets found" || echo "✅ Production secrets configured"

# Performance check
docker run --rm --env-file .env nexus-profile-service:test npm run db:check
echo "✅ Database connection optimized" || echo "❌ Database issues found"
```

## Estimated Timeline

| Priority | Tasks | Estimated Time | Dependencies |
|----------|-------|----------------|--------------|
| P0 | TypeScript fixes, env config | 4-6 hours | None |
| P1 | Security, performance, DB | 2-3 days | P0 complete |
| P2 | Testing, monitoring, docs | 1-2 weeks | P1 complete |
| P3 | Code quality, advanced features | 1-2 months | P2 complete |

## Success Criteria

### P0 Success
- [ ] `npm run build` completes without errors
- [ ] `docker build` completes successfully  
- [ ] Service starts and responds to health checks
- [ ] All 22 TypeScript errors resolved

### P1 Success
- [ ] Production secrets configured
- [ ] Performance benchmarks met (>1000 RPS)
- [ ] Security scan passes
- [ ] Database migrations automated

### P2 Success
- [ ] >80% test coverage achieved
- [ ] Monitoring dashboards operational
- [ ] Load testing passes (10M+ user simulation)
- [ ] Documentation complete

---

**Checklist Owner**: DevOps Team  
**Review Date**: Weekly until P1 complete, then monthly  
**Escalation**: P0 issues block deployment - escalate immediately
