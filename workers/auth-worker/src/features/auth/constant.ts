// Error Messages
export const ERROR_MESSAGES = {
  AUTH: {
    INVALID_CREDENTIALS: 'Invalid credentials',
    INVALID_OTP: 'Invalid or expired OTP',
    INVALID_TOKEN: 'Invalid token',
    INVALID_REFRESH_TOKEN: 'Invalid refresh token',
    SESSION_EXPIRED: 'Session expired',
    NOT_AUTHENTICATED: 'Not authenticated',
    NOT_AUTHORIZED: 'Not authorized',
    RATE_LIMIT_EXCEEDED: 'Too many requests',
    USER_NOT_FOUND: 'User not found',
    OAUTH_FAILED: 'OAuth authentication failed',
    WALLET_CONNECTION_FAILED: 'Wallet connection failed',
    SESSION_NOT_FOUND: 'Session not found'
  }
} as const;

// Authentication Constants
export const AUTH_CONSTANTS = {
  RESERVED_PREFIX: "__",
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_WINDOW: 60_000, // 1 minute
  ACCESS_TOKEN_EXPIRY: 15 * 60, // 3 minutes
  REFRESH_TOKEN_EXPIRY: 4 * 60 * 60, // 15 minutes
  SESSION_EXPIRY: 4 * 60 * 60, // 30 minutes
  NONCE_EXPIRY: 5 * 60 // 5 minutes
} as const;