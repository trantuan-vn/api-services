import { Context } from 'hono';
import { TOKEN_CONSTANTS, SECURITY_CONSTANTS, ERROR_MESSAGES } from './constant';

// I. Token Validation Utilities
export const tokenValidationUtils = {
  isValidAuthHeader(authHeader: string): boolean {
    const bearerPattern = /^Bearer [A-Za-z0-9\-_.]+$/;
    return bearerPattern.test(authHeader);
  },

  isValidTokenFormat(token: string): boolean {
    if (!token || token.length > TOKEN_CONSTANTS.MAX_TOKEN_LENGTH) {
      return false;
    }

    const jwtPattern = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;
    const apiKeyPattern = /^[A-Za-z0-9\-_]{16,}$/;
    
    return jwtPattern.test(token) || apiKeyPattern.test(token);
  },

  isValidTokenStructure(token: any): boolean {
    return token && 
           typeof token === 'object' && 
           Array.isArray(token.permissions) &&
           token.permissions.every((p: any) => typeof p === 'string');
  },

  isValidClientId(clientId: string): boolean {
    if (!clientId || typeof clientId !== 'string') {
      return false;
    }
    
    return SECURITY_CONSTANTS.UUID_PATTERN.test(clientId) || 
           SECURITY_CONSTANTS.CLIENT_ID_PATTERN.test(clientId);
  }
};

// II. Security Utilities
export const securityUtils = {
  sanitizeTokenData(tokenData: any): any {
    if (!tokenData || typeof tokenData !== 'object') {
      return tokenData;
    }

    // Remove sensitive information
    const { password, secret, privateKey, iat, exp, tokenHash, ...sanitized } = tokenData;
    
    // Ensure permissions is an array
    if (sanitized.permissions && !Array.isArray(sanitized.permissions)) {
      sanitized.permissions = [];
    }
    
    return sanitized;
  },

  validatePermissions(token: any, requiredPermissions: string[]): void {
    // Validate required permissions format
    if (!Array.isArray(requiredPermissions) || 
        !requiredPermissions.every(p => typeof p === 'string')) {
      throw new Error('Invalid permissions requirement');
    }

    // Check for admin:all permission
    const hasAdminAll = token.permissions.includes('admin:all');
    if (hasAdminAll) {
      return;
    }

    // Check all required permissions
    const hasAllPermissions = requiredPermissions.every(permission => 
      token.permissions.includes(permission)
    );

    if (!hasAllPermissions) {
      throw new Error(ERROR_MESSAGES.TOKEN.INSUFFICIENT_PERMISSIONS);
    }
  },

  addSecurityHeaders(c: Context): void {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('WWW-Authenticate', 'Bearer');
  }
};

// III. Token Generation Utilities
export const tokenGenerationUtils = {
  generateSecureToken(): string {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const token = btoa(String.fromCharCode(...randomBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `${TOKEN_CONSTANTS.TOKEN_PREFIX}${token}`;
  },

  async hashToken(token: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token + secret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async verifyToken(token: string, hash: string, secret: string): Promise<boolean> {
    const computed = await this.hashToken(token, secret);
    return computed === hash;
  }
};