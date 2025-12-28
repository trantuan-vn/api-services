// Error Messages
export const ERROR_MESSAGES = {
  TOKEN: {
    INVALID_TOKEN: 'Invalid token',
    TOKEN_EXPIRED: 'Token expired',
    TOKEN_NOT_FOUND: 'Token not found',
    INSUFFICIENT_PERMISSIONS: 'Insufficient permissions',
    RATE_LIMIT_EXCEEDED: 'Too many token requests',
    INVALID_CLIENT_ID: 'Invalid client ID',
    TOKEN_VALIDATION_TIMEOUT: 'Token validation timeout'
  }
} as const;

// Token Constants
export const TOKEN_CONSTANTS = {
  TOKEN_PREFIX: 'utk_',
  MAX_TOKEN_LENGTH: 1024,
  TOKEN_TIMEOUT_MS: 5000, // 5 seconds
  RATE_LIMIT_WINDOW: 60_000, // 1 minute
  RATE_LIMIT_MAX: 5,
  DEFAULT_EXPIRY_DAYS: 30,
  MAX_EXPIRY_DAYS: 365
} as const;

// Security Constants
export const SECURITY_CONSTANTS = {
  RESERVED_PREFIX: "__",
  TOKEN_PATTERN: /^[A-Za-z0-9\-_.]+$/,
  CLIENT_ID_PATTERN: /^[A-Za-z0-9_-]{1,64}$/,
  UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
} as const;

// Import permissions from other modules
import { EKYC_SERVICE_PERMISSIONS } from '../ekyc/constant';
import { WEBSOCKET_PERMISSIONS } from '../../ws/constant';

export const DEFAULT_PERMISSIONS = [
  ...EKYC_SERVICE_PERMISSIONS,
  ...WEBSOCKET_PERMISSIONS
];