# Profile Service - Docker Build & Run Guide

## Prerequisites
- Docker 20.0+ installed
- Docker Compose (optional)
- Access to PostgreSQL database
- Access to Redis instance
- `.env` file configured (see Environment Setup)

## Environment Setup

### 1. Create `.env` file from template
```bash
cp .env.example .env
```

### 2. Configure required environment variables
```bash
# Database (Required)
DATABASE_URL=postgresql://user:password@host:port/database?schema=profilesvc

# Authentication (Required)
AUTH_JWKS_URL=http://localhost:4001/.well-known/jwks.json
AUTH_JWT_ISSUER=nexus-auth
AUTH_JWT_AUDIENCE=nexus
AUTH_SERVICE_URL=http://localhost:4001

# Redis (Required for production)
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true

# System Secrets (Change in production!)
SYSTEM_SECRET=your-production-system-secret-here
SYSTEM_JWT_SECRET=your-production-jwt-secret-here

# Network Service
NETWORK_SERVICE_URL=http://localhost:4005
BADGE_AUTO_POST_ENABLED=true

# Application
NODE_ENV=production
PORT=4002
```

## Build Commands

### Standard Build
```bash
# Build the Docker image
docker build -t nexus-profile-service:latest .

# Build with specific tag
docker build -t nexus-profile-service:v0.1.0 .

# Build with build args (if needed)
docker build --build-arg NODE_ENV=production -t nexus-profile-service:latest .
```

### Development Build (with cache)
```bash
# Build with cache from previous builds
docker build --cache-from nexus-profile-service:latest -t nexus-profile-service:dev .
```

## Run Commands

### Basic Run
```bash
# Run with environment file
docker run --rm -p 4002:4002 --env-file .env nexus-profile-service:latest

# Run in background (detached)
docker run -d -p 4002:4002 --env-file .env --name profile-service nexus-profile-service:latest
```

### Run with Docker Network
```bash
# Create network for microservices
docker network create nexus-network

# Run connected to network
docker run -d \
  --network nexus-network \
  -p 4002:4002 \
  --env-file .env \
  --name profile-service \
  nexus-profile-service:latest
```

### Run with Volume Mounts (for logs)
```bash
docker run -d \
  -p 4002:4002 \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  --name profile-service \
  nexus-profile-service:latest
```

## Docker Compose (Recommended)

### Create `docker-compose.yml`
```yaml
version: '3.8'

services:
  profile-service:
    build: .
    ports:
      - "4002:4002"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    networks:
      - nexus-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4002/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: neondb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - nexus-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - nexus-network

volumes:
  postgres_data:
  redis_data:

networks:
  nexus-network:
    driver: bridge
```

### Run with Docker Compose
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f profile-service

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

## Debugging & Inspection

### Container Inspection
```bash
# Check running containers
docker ps

# View container logs
docker logs profile-service
docker logs -f profile-service  # Follow logs

# Execute commands in running container
docker exec -it profile-service sh

# Check container resource usage
docker stats profile-service
```

### Health Check Verification
```bash
# Test health endpoint
curl http://localhost:4002/health

# Detailed health check
curl http://localhost:4002/health/detailed

# Circuit breaker status
curl http://localhost:4002/health/circuit-breakers
```

### File System Inspection
```bash
# Check built files in container
docker exec -it profile-service ls -la /app/dist

# Verify Prisma client
docker exec -it profile-service ls -la /app/node_modules/.prisma

# Check configuration
docker exec -it profile-service cat /app/dist/config/env.js
```

## AWS ECR Deployment

### 1. Create ECR Repository
```bash
aws ecr create-repository --repository-name nexus/profile-service --region us-east-1
```

### 2. Get Login Token
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 3. Tag and Push
```bash
# Tag for ECR
docker tag nexus-profile-service:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/nexus/profile-service:latest

# Push to ECR
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/nexus/profile-service:latest

# Push specific version
docker tag nexus-profile-service:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/nexus/profile-service:v0.1.0
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/nexus/profile-service:v0.1.0
```

## Production Deployment Checklist

### Before Deploy
- [ ] Fix all TypeScript compilation errors
- [ ] Update production secrets in `.env`
- [ ] Configure production database URL
- [ ] Set up Redis cluster/instance
- [ ] Configure proper CORS origins
- [ ] Set up monitoring and logging
- [ ] Run database migrations

### Deploy Steps
```bash
# 1. Build production image
docker build -t nexus-profile-service:prod .

# 2. Run database migrations
docker run --rm --env-file .env nexus-profile-service:prod npm run db:migrate

# 3. Apply production indexes
docker run --rm --env-file .env nexus-profile-service:prod npm run db:indexes

# 4. Deploy to production
docker run -d \
  --name profile-service-prod \
  -p 4002:4002 \
  --env-file .env.production \
  --restart unless-stopped \
  nexus-profile-service:prod
```

## Troubleshooting

### Common Issues

**Build Fails with TypeScript Errors**
```bash
# Check TypeScript compilation locally first
npm run build

# If errors, fix them before Docker build
# See AUDIT_REPORT.md for specific fixes needed
```

**Container Exits Immediately**
```bash
# Check logs for startup errors
docker logs profile-service

# Common causes:
# - Missing DATABASE_URL
# - Database connection failed
# - Redis connection failed
# - Missing required environment variables
```

**Health Check Fails**
```bash
# Test health endpoint manually
curl http://localhost:4002/health

# Check if service is binding to correct port
docker exec -it profile-service netstat -tlnp
```

**Database Connection Issues**
```bash
# Test database connection
docker exec -it profile-service npm run db:check

# Check database URL format
# postgresql://user:password@host:port/database?schema=profilesvc
```

### Performance Monitoring
```bash
# Monitor container resources
docker stats profile-service

# Check memory usage
docker exec -it profile-service cat /proc/meminfo

# Monitor logs for performance issues
docker logs profile-service | grep -i "slow\|error\|timeout"
```

## Security Notes

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Use production secrets** - Change default SYSTEM_SECRET values
3. **Network Security** - Run containers in isolated networks
4. **User Permissions** - Container runs as non-root user (nexus:1001)
5. **Image Scanning** - Scan images for vulnerabilities before deploy

---

**Last Updated**: October 14, 2025  
**Service Version**: 0.1.0  
**Docker Requirements**: Docker 20.0+, 2GB RAM, 1GB disk space
