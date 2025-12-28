import { Context, Next } from 'hono';
import { createTokenApplicationService } from './application.js';
import { handleError, getClientIp } from '../../../shared/utils';
import { TOKEN_CONSTANTS, ERROR_MESSAGES } from './constant';
import { 
  tokenValidationUtils, 
  securityUtils 
} from './utils';

export function createTokenValidationMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      // Luôn xóa token data cũ trước khi xác thực lại
      c.set('tokenData', undefined);
      
      const clientId = c.req.header('X-Client-ID') || c.req.query('client_id');
      
      if (!clientId) {
        throw new Error(ERROR_MESSAGES.TOKEN.INVALID_CLIENT_ID);
      }

      if (!tokenValidationUtils.isValidClientId(clientId)) {
        throw new Error(ERROR_MESSAGES.TOKEN.INVALID_CLIENT_ID);
      }

      // Lấy token từ header Authorization Bearer
      const authHeader = c.req.header('Authorization');
      
      if (authHeader) {
        // Input Validation - Protection against injection attacks
        if (!tokenValidationUtils.isValidAuthHeader(authHeader)) {
          throw new Error('Invalid authorization header format');
        }

        const token = authHeader.substring(7); // Lấy phần sau "Bearer "
        
        // Token Length Validation - Prevention of DoS attacks
        if (!token || token.length > TOKEN_CONSTANTS.MAX_TOKEN_LENGTH) {
          throw new Error(ERROR_MESSAGES.TOKEN.INVALID_TOKEN);
        }

        // Token Format Validation - Basic sanitization
        if (!tokenValidationUtils.isValidTokenFormat(token)) {
          throw new Error('Invalid token format');
        }

        const applicationService = createTokenApplicationService(c, bindingName);
        
        // Timeout Protection - Prevention of DoS attacks
        const validationPromise = applicationService.validateApiTokenUseCase(clientId, token);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(ERROR_MESSAGES.TOKEN.TOKEN_VALIDATION_TIMEOUT)), TOKEN_CONSTANTS.TOKEN_TIMEOUT_MS)
        );

        const validationResult = await Promise.race([validationPromise, timeoutPromise]) as any;
        
        if (!validationResult.isValid) {
          throw new Error(validationResult.error || ERROR_MESSAGES.TOKEN.INVALID_TOKEN);
        }

        // Token Data Sanitization
        const sanitizedTokenData = securityUtils.sanitizeTokenData(validationResult.token);
        c.set('tokenData', sanitizedTokenData);
      }
      
      await next();
    } catch (error) {
      const { errorResponse, status } = await handleError(c, error, 'Token validation failed');
      securityUtils.addSecurityHeaders(c);
      return c.json(errorResponse, status);
    }
  };
}

// Permission Validation
export function requirePermissions(c: Context, permissions: string[]) {
    const token = c.get('tokenData');
    
    if (!token) {
        throw new Error('Not authenticated');
    }

    // Enhanced Token Validation
    if (!tokenValidationUtils.isValidTokenStructure(token)) {
        throw new Error('Invalid token structure');
    }

    // Permission Validation
    securityUtils.validatePermissions(token, permissions);
    
    return token;
}

// Security monitoring middleware
export function securityLoggingMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    
    await next();
    
    const processingTime = Date.now() - startTime;
    const tokenData = c.get('tokenData');

    // Log security events
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      processingTime,
      userId: tokenData?.id || 'anonymous',
      clientIP: getClientIp(c),
      userAgent: c.req.header('user-agent'),
      event: 'api_token_request'
    };
    
    console.log(JSON.stringify(logEntry));
  };
}

// Rate limiting middleware
export function createTokenRateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const clientId = c.req.header('X-Client-ID');
    if (!clientId) return await next();

    const key = `token_rate_limit:${clientId}`;
    const data = await c.env.KV.get(key);
    
    if (data) {
      const { count, resetTime } = JSON.parse(data);
      if (Date.now() < resetTime && count >= TOKEN_CONSTANTS.RATE_LIMIT_MAX) {
        return c.json({ 
          error: ERROR_MESSAGES.TOKEN.RATE_LIMIT_EXCEEDED 
        }, 429);
      }
    }
    
    await next();
  };
}