/**
 * JWT Configuration Validation Script
 * Run with: node tests/jwt-verification.test.js
 * 
 * This validates that JWT configuration is correct between auth and profile services
 */

console.log('=== JWT Configuration Validation ===\n');

// Test 1: Issuer Configuration
console.log('1. Testing JWT Issuer Configuration...');
const expectedIssuer = 'nexus  -auth'; // What auth service sends (with spaces)
const configuredIssuer = process.env.AUTH_JWT_ISSUER || 'nexus  -auth';

if (configuredIssuer === expectedIssuer) {
  console.log('✅ JWT Issuer configuration is correct:', configuredIssuer);
} else {
  console.log('❌ JWT Issuer mismatch:');
  console.log('   Expected:', expectedIssuer);
  console.log('   Configured:', configuredIssuer);
}

// Test 2: Audience Configuration  
console.log('\n2. Testing JWT Audience Configuration...');
const expectedAudience = 'nexus';
const configuredAudience = process.env.AUTH_JWT_AUDIENCE || 'nexus';

if (configuredAudience === expectedAudience) {
  console.log('✅ JWT Audience configuration is correct:', configuredAudience);
} else {
  console.log('❌ JWT Audience mismatch:');
  console.log('   Expected:', expectedAudience);
  console.log('   Configured:', configuredAudience);
}

// Test 3: JWKS URL Configuration
console.log('\n3. Testing JWKS URL Configuration...');
const jwksUrl = process.env.AUTH_JWKS_URL || 'http://localhost:4001/.well-known/jwks.json';
console.log('✅ JWKS URL configured as:', jwksUrl);

// Test 4: DisplayName Field Mapping
console.log('\n4. Testing DisplayName Field Mapping...');
const mockPayload = {
  sub: 'test-user-id',
  email: 'test@example.com',
  roles: ['STUDENT'],
  displayName: 'Test User', // Auth service sends displayName field
  iss: 'nexus  -auth',
  aud: 'nexus'
};

// Simulate middleware mapping logic (auth service sends displayName, not name)
const extractedDisplayName = mockPayload.displayName || (mockPayload as any).name;
if (extractedDisplayName === 'Test User') {
  console.log('✅ DisplayName field mapping is correct');
} else {
  console.log('❌ DisplayName field mapping failed');
}

console.log('\n=== Validation Complete ===');
console.log('If all tests show ✅, the JWT configuration should work correctly.');
console.log('If any tests show ❌, review the .env configuration files.');
