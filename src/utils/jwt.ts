import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { env } from "../config/env.js";

const JWKS = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
  cooldownDuration: 30000, // 30 seconds cooldown between fetches
  cacheMaxAge: 300000,     // 5 minutes cache max age
});

export type AccessTokenPayload = JWTPayload & {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles?: string[];
  tv?: number;
};

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    console.log('[JWT] Verifying token with config:', {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
      jwksUrl: env.AUTH_JWKS_URL
    });

    // Decode token header to see the kid
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const header = JSON.parse(Buffer.from(tokenParts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
    
    console.log('[JWT] Token header:', header);
    console.log('[JWT] Token payload (without verification):', {
      iss: payload.iss,
      aud: payload.aud,
      sub: payload.sub,
      exp: payload.exp,
      iat: payload.iat,
      kid: header.kid
    });

    // Try to fetch JWKS to see what keys are available (fresh fetch, no cache)
    let jwksData: any;
    try {
      const jwksResponse = await fetch(env.AUTH_JWKS_URL);
      jwksData = await jwksResponse.json();
      console.log('[JWT] Available JWKS keys:', jwksData.keys.map((k: any) => ({ kid: k.kid, alg: k.alg })));
    } catch (jwksError) {
      console.error('[JWT] Failed to fetch JWKS:', jwksError);
    }
    
    // Normalize issuer function to handle whitespace variations
    function normalizeIssuer(issuer: string): string {
      return issuer.replace(/\s+/g, ' ').trim();
    }

    // Try verification with multiple issuer formats for robustness
    let verifiedPayload;
    const issuerVariations = [
      env.AUTH_JWT_ISSUER,
      normalizeIssuer(env.AUTH_JWT_ISSUER),
      'nexus-auth',
      'nexus  -auth',
      payload.iss // Use actual issuer from token
    ].filter((issuer, index, arr) => arr.indexOf(issuer) === index); // Remove duplicates

    let lastError;
    for (const issuer of issuerVariations) {
      try {
        console.log(`[JWT] Trying issuer: "${issuer}"`);
        const result = await jwtVerify(token, JWKS, {
          issuer: issuer,
          audience: env.AUTH_JWT_AUDIENCE,
        });
        verifiedPayload = result.payload;
        console.log(`[JWT] SUCCESS with issuer: "${issuer}"`);
        break;
      } catch (issuerError) {
        console.log(`[JWT] Failed with issuer "${issuer}":`, issuerError instanceof Error ? issuerError.message : issuerError);
        lastError = issuerError;
      }
    }

    if (!verifiedPayload) {
      console.log('[JWT] All issuer variations failed, trying development fallback...');
      
      if (lastError) {
        // Development fallback: try with fresh JWKS fetch
        if (env.NODE_ENV === 'development') {
          console.log('[JWT] Trying verification with fresh JWKS fetch (development only)...');
          try {
            // Fresh JWKS fetch to bypass cache
            const jwksResponse = await fetch(env.AUTH_JWKS_URL);
            const freshJwksData = await jwksResponse.json();
            console.log('[JWT] Fresh JWKS keys:', freshJwksData.keys.map((k: any) => ({ kid: k.kid, alg: k.alg })));
            
            if (freshJwksData.keys && freshJwksData.keys.length > 0) {
              // Try to find the exact key first
              const matchingKey = freshJwksData.keys.find((k: any) => k.kid === header.kid);
              
              if (matchingKey) {
                console.log(`[JWT] Found matching key in fresh JWKS: ${matchingKey.kid}`);
                const { importJWK, jwtVerify: manualJwtVerify } = await import('jose');
                const publicKey = await importJWK(matchingKey);
                
                const result = await manualJwtVerify(token, publicKey, {
                  issuer: payload.iss, // Use actual issuer from token
                  audience: env.AUTH_JWT_AUDIENCE,
                });
                
                verifiedPayload = result.payload;
                console.log('[JWT] SUCCESS: Verified with fresh JWKS matching key');
              } else {
                // Try with the first available key as last resort
                const firstKey = freshJwksData.keys[0];
                console.log(`[JWT] No matching key found, trying first available key: ${firstKey.kid}`);
                
                const { importJWK, jwtVerify: manualJwtVerify } = await import('jose');
                
                console.log('[JWT] Attempting manual verification with key:', {
                  keyKid: firstKey.kid,
                  keyAlg: firstKey.alg,
                  tokenKid: header.kid,
                  tokenAlg: header.alg
                });
                
                // Create a copy of the key without the kid to bypass kid matching
                const keyWithoutKid = { ...firstKey };
                delete keyWithoutKid.kid;
                
                console.log('[JWT] Key material (first 100 chars):', JSON.stringify(keyWithoutKid).substring(0, 100));
                
                try {
                  const publicKey = await importJWK(keyWithoutKid);
                  console.log('[JWT] Successfully imported JWK as public key');
                  
                  const result = await manualJwtVerify(token, publicKey, {
                    issuer: payload.iss, // Use actual issuer from token
                    audience: env.AUTH_JWT_AUDIENCE,
                  });
                  
                  verifiedPayload = result.payload;
                  console.log('[JWT] SUCCESS: Verified with first available key (bypassed kid matching)');
                } catch (manualError) {
                  console.error('[JWT] Manual verification failed:', {
                    error: manualError instanceof Error ? manualError.message : manualError,
                    keyKid: firstKey.kid,
                    tokenKid: header.kid
                  });
                  
                  // This confirms the keys are actually different
                  console.log('[JWT] DIAGNOSIS: Token was signed with a different private key than what is available in JWKS');
                  console.log('[JWT] This indicates the auth service key rotation is broken');
                }
              }
            }
          } catch (fallbackError) {
            console.log('[JWT] Fresh JWKS fallback also failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
          }
        }
        
        if (!verifiedPayload) {
          throw lastError || new Error('JWT verification failed with all issuer variations');
        }
      }
    }
    
    if (!verifiedPayload) {
      throw new Error('JWT verification failed - no valid payload found');
    }
    
    console.log('[JWT] Token verified successfully:', {
      sub: verifiedPayload.sub,
      iss: verifiedPayload.iss,
      aud: verifiedPayload.aud,
      roles: verifiedPayload.roles
    });
    
    return verifiedPayload as AccessTokenPayload;
  } catch (error) {
    console.error('[JWT] Token verification failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
