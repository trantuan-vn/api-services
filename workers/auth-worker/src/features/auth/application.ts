import { Context } from 'hono';
import { getIdFromName, isAdmin } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { SiweMessage } from 'siwe';

import { OAuthProvider, Session } from './domain';
import { 
  jwtUtils, 
  validationUtils, 
  walletUtils, 
  oauthUtils,
} from './utils';
import { createOAuthService, createRepository, createOTPService, createWalletService } from './infrastructure';
import { AUTH_CONSTANTS, ERROR_MESSAGES } from './constant';

interface IApplicationService {
  // I. OAUTH
  getAuthUrlUseCase(provider: OAuthProvider, sessionId: string): Promise<string>;
  exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string): Promise<any>;
  connectOAuthUseCase(sessionId: string, identifier: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  
  // II. EMAIL/PHONE
  getRequestOtpUseCase(identifier: string, sessionId: string): Promise<void>;
  verifyOtpUseCase(identifier: string, sessionId: string, otp: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  
  // III. WALLET
  generateNonceUseCase(sessionId: string): Promise<string>;
  verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage>;
  connectWalletUseCase(sessionId: string, address: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  
  // IV. Common
  logoutUseCase(identifier: string, sessionId: string): Promise<void>;
  logoutAllUseCase(identifier: string): Promise<void>;
  verifyTokenUseCase(sessionId: string, token: string, refreshToken: string): Promise<{ ok: boolean; user: any }>;
  refreshTokenUseCase(sessionId: string, refreshToken: string): Promise<{ ok: boolean; user: any; token: string; refreshToken: string }>;
}

export function createApplicationService(c: Context, bindingName: string): IApplicationService {
  const getRepository = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    if (!userDO) throw new Error(ERROR_MESSAGES.AUTH.USER_NOT_FOUND);
    return createRepository(userDO);
  };

  const createUserSession = async (
    repository: any,
    sessionId: string,
    user: any,
    type: 'otp' | 'siwe' | 'oauth',
    ipAddress: string,
    userAgent: string
  ) => {
    const jwtSecret= await c.env.JWT_SECRET.get();
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }
    const token = await jwtUtils.generateAccessToken(user.id, user.identifier, jwtSecret);
    const refreshToken = await jwtUtils.generateRefreshToken(user.id, user.identifier, jwtSecret);

    const sessionData: Session = {
      hashSessionId: sessionId,
      type,
      expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString(),
      token,
      refreshToken,
      ipAddress,
      userAgent,
      isActive: true,
    };
    await repository.sessions.create(sessionData);
    
    return { token, refreshToken };
  };

  const getOrCreateUser = async (repository: any, identifier: string, additionalData: any = {}) => {
    const encryptSecret= await c.env.ENCRYPTION_SECRET.get();
    if (!encryptSecret) {
      throw new Error("ENCRYPTION_SECRET is not defined in environment variables");
    }

    const user = await repository.users.get();
    
    if (user) return user;

    const baseUser = {
      identifier: validationUtils.normalizeIdentifier(identifier),
      role: isAdmin(identifier) ? 'admin' : 'member',
      ...additionalData
    };

    // Generate wallet for new users (except wallet connections)
    if (!additionalData.address) {
      const wallet = await walletUtils.generateWallet(encryptSecret);
      Object.assign(baseUser, {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonicPhrase: wallet.mnemonicPhrase,
      });
    }

    // Set email/phone based on identifier type
    if (validationUtils.isValidEmail(identifier)) {
      Object.assign(baseUser, { email: identifier });
    } else if (validationUtils.isValidPhone(identifier)) {
      Object.assign(baseUser, { phone: identifier });
    }

    return await repository.users.save(baseUser);
  };

  return {
    // I. OAUTH
    async getAuthUrlUseCase(provider: OAuthProvider, sessionId: string): Promise<string> {
      const oauthService = createOAuthService(c.env);      
      const state = await oauthService.generateState(sessionId);

      const config = await oauthUtils.getOAuthConfig(provider, c.env);
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: oauthUtils.getOAuthScopes(provider),
        state,
      });

      const endpoints: Record<OAuthProvider, string> = {
        google: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        apple: `https://appleid.apple.com/auth/authorize?${params}`,
        facebook: `https://www.facebook.com/v18.0/dialog/oauth?${params}`,
        github: `https://github.com/login/oauth/authorize?${params}`,
        twitter: `https://x.com/i/oauth2/authorize?${params}`
      };

      return endpoints[provider];
    },

    async exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string): Promise<any> {
      const oauthService = createOAuthService(c.env);      
      const tokenData = await oauthService.exchangeOAuthCode(provider, sessionId, state, code);
      return await oauthService.getUserInfoFromProvider(provider, tokenData.access_token);      
    },

    async connectOAuthUseCase(sessionId: string, identifier: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      const repository = getRepository(identifier);
      const user = await getOrCreateUser(repository, identifier);
      return await createUserSession(repository, sessionId, user, 'oauth', ipAddress, userAgent);
    },

    // II. EMAIL/PHONE
    async getRequestOtpUseCase(identifier: string, sessionId: string): Promise<void> {
      const otpService = createOTPService(c.env);
      const otp = await otpService.generateOTP(sessionId);
      const nIdentifier = validationUtils.normalizeIdentifier(identifier);

      if (validationUtils.isValidEmail(nIdentifier)) {
        await otpService.sendEmailOTP(nIdentifier, otp);
      } else if (validationUtils.isValidPhone(nIdentifier)) {
        await otpService.sendSmsOTP(nIdentifier, otp, "VONAGE");
      }
    },

    async verifyOtpUseCase(identifier: string, sessionId: string, otp: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      const otpService = createOTPService(c.env);
      const isValid = await otpService.verifyOTP(otp, sessionId);
      if (!isValid) {
        throw new Error(ERROR_MESSAGES.AUTH.INVALID_OTP);
      }

      const repository = getRepository(identifier);
      const user = await getOrCreateUser(repository, identifier);
      return await createUserSession(repository, sessionId, user, 'otp', ipAddress, userAgent);
    },

    // III. WALLET
    async generateNonceUseCase(sessionId: string): Promise<string> {
      const walletService = createWalletService(c.env);      
      return await walletService.generateNonceAndStore(sessionId);
    },

    async verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage> {
      const walletService = createWalletService(c.env);      
      return await walletService.verifySignature(sessionId, message, signature, c.env.SIWE_DOMAIN, c.env.FRONTEND_URL);
    },

    async connectWalletUseCase(sessionId: string, address: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      const repository = getRepository(address);
      const user = await getOrCreateUser(repository, address, { address });
      return await createUserSession(repository, sessionId, user, 'siwe', ipAddress, userAgent);
    },

    // IV. Common
    async logoutUseCase(identifier: string, sessionId: string): Promise<void> {
      const repository = getRepository(identifier);
      await repository.sessions.update(sessionId, { isActive: false });
    },

    async logoutAllUseCase(identifier: string): Promise<void> {
      const repository = getRepository(identifier);
      await repository.sessions.deactivateAllUserSessions(identifier);
    },

    async verifyTokenUseCase(sessionId: string, token: string, refreshToken: string): Promise<{ ok: boolean; user: any }> {
      const jwtSecret= await c.env.JWT_SECRET.get();
      if (!jwtSecret) {
        throw new Error("JWT_SECRET is not defined in environment variables");
      }
      const result = await jwtUtils.verifyJWT(token, jwtSecret);
      if (!result.ok) {
        throw new Error(result.error ?? ERROR_MESSAGES.AUTH.INVALID_TOKEN);
      }
      
      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error("identifier not found in token");
      }
      
      const repository = getRepository(identifier);
      const user = await repository.users.get();
      if (!user) {
        throw new Error(ERROR_MESSAGES.AUTH.USER_NOT_FOUND);
      }
      const session = await repository.sessions.findById(sessionId);
      if (!session) {
        throw new Error(ERROR_MESSAGES.AUTH.SESSION_NOT_FOUND);
      }
      validationUtils.validateSession(session, token, refreshToken);

      return { ok: true, user };
    },

    async refreshTokenUseCase(sessionId: string, refreshToken: string): Promise<{ ok: boolean; user: any; token: string; refreshToken: string }> {
      const jwtSecret= await c.env.JWT_SECRET.get();
      if (!jwtSecret) {
        throw new Error("JWT_SECRET is not defined in environment variables");
      }

      const result = await jwtUtils.verifyJWT(refreshToken, jwtSecret);
      if (!result.ok) {
        const errorMessage = result.error
          ?.replace('token', 'refreshToken')
          ?.replace('Token', 'RefreshToken') ?? ERROR_MESSAGES.AUTH.INVALID_REFRESH_TOKEN;
        throw new Error(errorMessage);
      }

      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error(ERROR_MESSAGES.AUTH.INVALID_REFRESH_TOKEN);
      }

      const repository = getRepository(identifier);
      const user = await repository.users.get();
      if (!user) {
        throw new Error(ERROR_MESSAGES.AUTH.USER_NOT_FOUND);
      }

      const session = await repository.sessions.findById(sessionId);
      validationUtils.validateSession(session, undefined, refreshToken);

      const newToken = await jwtUtils.generateAccessToken(user.id, user.identifier, jwtSecret);
      const newRefreshToken = await jwtUtils.generateRefreshToken(user.id, user.identifier, jwtSecret);
      
      await repository.sessions.update(sessionId, { 
        token: newToken, 
        refreshToken: newRefreshToken, 
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString() 
      });

      return { 
        ok: true, 
        user, 
        token: newToken, 
        refreshToken: newRefreshToken 
      };
    }
  };
}