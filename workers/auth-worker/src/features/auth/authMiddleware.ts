import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { createApplicationService } from './application';
import { createVersionApplicationService } from '../admin/version/application';
import { cookieUtils } from './utils';
import { handleError, getClientIp, handleErrorWithoutIp } from '../../shared/utils';
import { AUTH_CONSTANTS, ERROR_MESSAGES } from './constant';

// Main authentication middleware factory
export function createAuthMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      // Reset user context
      c.set('user', undefined);
      
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        throw new Error("sessionId not found");
      }
      const token = getCookie(c, 'token');
      if (!token) {
        throw new Error("token not found");
      }
      const refreshToken = getCookie(c, 'refreshToken');
      // If no refresh token, clear cookies and continue
      if (!refreshToken) {
        throw new Error("refreshToken not found");
      }
      
      await processAuthentication(c, bindingName, sessionId, token, refreshToken);
    } catch (error) {
      handleErrorWithoutIp(error, "Auth middleware error");
      cookieUtils.clearAuthCookies(c);
    }
    
    await next();
  };
}

// Authentication processing logic
async function processAuthentication(
  c: Context,
  bindingName: string,
  sessionId: string | undefined,
  token: string | undefined,
  refreshToken: string
): Promise<void> {
  const applicationService = createApplicationService(c, bindingName);
  
  if (!token) {
    // Token missing, try to refresh
    await handleTokenRefresh(c, applicationService, sessionId, refreshToken);
  } else {
    // Token exists, verify it
    await handleTokenVerification(c, applicationService, sessionId, token, refreshToken);
  }
}

// Handle token verification flow
async function handleTokenVerification(
  c: Context,
  applicationService: any,
  sessionId: string | undefined,
  token: string,
  refreshToken: string
): Promise<void> {
  try {
    const result = await applicationService.verifyTokenUseCase(sessionId, token, refreshToken);
    if (result.ok) {
      c.set('user', result.user);
    } else {
      // Token verification failed, try refresh
      await handleTokenRefresh(c, applicationService, sessionId, refreshToken);
    }
  } catch (error) {
    handleErrorWithoutIp(error, "Token verification error");
    await handleTokenRefresh(c, applicationService, sessionId, refreshToken);
  }
}

// Handle token refresh flow
async function handleTokenRefresh(
  c: Context,
  applicationService: any,
  sessionId: string | undefined,
  refreshToken: string
): Promise<void> {

  const result = await applicationService.refreshTokenUseCase(sessionId, refreshToken);
  if (result.ok) {
    cookieUtils.setCookieWithOption(c, 'token', result.token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
    cookieUtils.setCookieWithOption(c, 'refreshToken', result.refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);
    c.set('user', result.user);
  } else {
    throw new Error(ERROR_MESSAGES.AUTH.INVALID_REFRESH_TOKEN);
  }
}


// Require authentication middleware
export function requireAuth(c: Context) {
  const user = c.get('user');
  if (!user) {
    throw new Error(ERROR_MESSAGES.AUTH.NOT_AUTHENTICATED);
  }
  return user;
}

// Require admin role middleware
export function requireAdmin(c: Context) {
  const user = requireAuth(c);
  if (user.role !== 'admin') {
    throw new Error(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED);
  }
  return user;
}
// Version check middleware for admin users
export function createVersionCheckMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      const user = requireAuth(c);
      const versionApplicationService = createVersionApplicationService(c, bindingName);
      await versionApplicationService.upgradeVersion(user.identifier);            
    } catch (error) {
      handleErrorWithoutIp(error, "Failed to upgrade version");      
    } 
    await next();   
  };
}

// Security headers middleware
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    
    // Security headers
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=()');
    
    // CSP header
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
    );
  };
}









// Xem xet sau de apply dan  
// Rate limiting middleware factory
export function createRateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      const ip = getClientIp(c);
      if (!ip) {
        return await next();
      }

      const ipData = await c.env.NONCE_KV.get(`rate_limit:${ip}`);
      
      if (ipData) {
        const data = JSON.parse(ipData);
        const now = Date.now();
        
        // Check if IP is blocked
        if (now < data.blockUntil && data.failCount >= AUTH_CONSTANTS.RATE_LIMIT_MAX) {
          const remainingTime = Math.ceil((data.blockUntil - now) / 1000);
          return c.json({ 
            error: ERROR_MESSAGES.AUTH.RATE_LIMIT_EXCEEDED,
            retryAfter: remainingTime 
          }, 429);
        }
        
        // Reset if block period has expired
        if (now > data.blockUntil) {
          await c.env.NONCE_KV.delete(`rate_limit:${ip}`);
        }
      }

    } catch (error) {
      handleErrorWithoutIp(error, "Rate limit middleware error");
    }

    await next();

  };
}

// Update rate limit on failure
export async function updateRateLimit(env: Env, ip: string): Promise<void> {
  if (!ip) return;

  const key = `rate_limit:${ip}`;
  const now = Date.now();
  const existingData = await env.NONCE_KV.get(key);
  
  let data: any = { failCount: 1, lastAttempt: now, blockUntil: now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW };
  
  if (existingData) {
    const existing = JSON.parse(existingData);
    data = {
      failCount: existing.failCount + 1,
      lastAttempt: now,
      blockUntil: now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW
    };
  }
  
  await env.NONCE_KV.put(key, JSON.stringify(data), {
    expirationTtl: Math.ceil(AUTH_CONSTANTS.RATE_LIMIT_WINDOW / 1000) * 2
  });
}

// CORS middleware for auth endpoints
export function corsMiddleware() {
  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin');
    const allowedOrigins = [c.env.FRONTEND_URL];
    
    if (origin && allowedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    }
    
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    
    await next();
  };
}

// Request logging middleware
export function requestLoggingMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const ip = getClientIp(c);
    
    await next();
    
    const duration = Date.now() - start;
    const status = c.res.status;
    
    console.log(`${method} ${path} - ${status} - ${duration}ms - IP: ${ip}`);
  };
}

// Error handling middleware
export function errorHandlingMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (error) {
      // Handle error
      const { errorResponse, status } = await handleError(
        c, 
        error, 
        'Internal server error'
      );
      // Send error response
      return c.json(errorResponse, status);
    }
  };
}

// Composite middleware for auth routes
export function createAuthCompositeMiddleware(bindingName: string) {
  return [
    corsMiddleware(),
    securityHeadersMiddleware(),
    requestLoggingMiddleware(),
    errorHandlingMiddleware(),
    createRateLimitMiddleware(),
    createAuthMiddleware(bindingName)
  ];
}

// Route-specific middleware combinations
export const middlewarePresets = {
  public: [
    corsMiddleware(),
    securityHeadersMiddleware(),
    requestLoggingMiddleware(),
    createRateLimitMiddleware()
  ],
  
  authenticated: (bindingName: string) => [
    ...middlewarePresets.public,
    createAuthMiddleware(bindingName)
  ],
  
  adminOnly: (bindingName: string) => [
    ...middlewarePresets.authenticated(bindingName),
    (c: Context, next: Next) => {
      requireAdmin(c);
      return next();
    }
  ]
};

// Helper to apply multiple middleware
export function applyMiddleware(...middlewares: Function[]) {
  return async (c: Context, next: Next) => {
    let index = -1;
    
    async function dispatch(i: number): Promise<void> {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      
      if (i === middlewares.length) {
        return await next();
      }
      
      const middleware = middlewares[i];
      if (!middleware) {
        throw new Error(`Middleware at index ${i} is undefined`);
      }
      return await middleware(c, () => dispatch(i + 1));
    }
    
    return await dispatch(0);
  };
}

