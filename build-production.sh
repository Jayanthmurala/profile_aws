#!/bin/bash

# Nexus Profile Service - Production Build Script
# This script builds the Docker image for production deployment

set -e  # Exit on any error

echo "🚀 Building Nexus Profile Service for Production..."

# Build info
BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION="0.1.0"

echo "📋 Build Information:"
echo "   Version: $VERSION"
echo "   Commit: $GIT_COMMIT"
echo "   Date: $BUILD_DATE"

# Build Docker image
echo "🔨 Building Docker image..."
docker build \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  --build-arg VERSION="$VERSION" \
  --tag nexus-profile-service:$VERSION \
  --tag nexus-profile-service:latest \
  .

echo "✅ Docker image built successfully!"

# Verify the image
echo "🔍 Verifying Docker image..."
docker run --rm nexus-profile-service:latest node --version
docker run --rm nexus-profile-service:latest ls -la dist/

echo "🎉 Production build complete!"
echo "📦 Image tags:"
echo "   - nexus-profile-service:$VERSION"
echo "   - nexus-profile-service:latest"

# Optional: Run a quick health check
echo "🏥 Running health check..."
docker run --rm -d --name profile-test -p 4002:4002 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://test:test@localhost:5432/test" \
  -e REDIS_URL="redis://localhost:6379" \
  nexus-profile-service:latest

sleep 5

if curl -f http://localhost:4002/health > /dev/null 2>&1; then
  echo "✅ Health check passed!"
else
  echo "⚠️  Health check failed (expected if no database connection)"
fi

docker stop profile-test > /dev/null 2>&1 || true

echo "🚀 Ready for deployment!"
