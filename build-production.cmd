@echo off
REM Nexus Profile Service - Production Build Script for Windows
REM This script builds the Docker image for production deployment

echo 🚀 Building Nexus Profile Service for Production...

REM Build info
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "BUILD_DATE=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%T%dt:~8,2%:%dt:~10,2%:%dt:~12,2%Z"
set "VERSION=0.1.0"

echo 📋 Build Information:
echo    Version: %VERSION%
echo    Date: %BUILD_DATE%

REM Build Docker image
echo 🔨 Building Docker image...
docker build ^
  --build-arg BUILD_DATE="%BUILD_DATE%" ^
  --build-arg VERSION="%VERSION%" ^
  --tag nexus-profile-service:%VERSION% ^
  --tag nexus-profile-service:latest ^
  .

if %ERRORLEVEL% neq 0 (
    echo ❌ Docker build failed!
    exit /b 1
)

echo ✅ Docker image built successfully!

REM Verify the image
echo 🔍 Verifying Docker image...
docker run --rm nexus-profile-service:latest node --version
docker run --rm nexus-profile-service:latest ls -la dist/

echo 🎉 Production build complete!
echo 📦 Image tags:
echo    - nexus-profile-service:%VERSION%
echo    - nexus-profile-service:latest

echo 🚀 Ready for deployment!
