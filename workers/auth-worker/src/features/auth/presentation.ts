import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';  
import { handleError, parseBody, getIPAndUserAgent, getSessionIdHash } from '../../shared/utils';
import { requireAuth } from './authMiddleware';
import { createApplicationService } from './application';
import { 
  OTPRequestSchema, 
  OTPVerificationSchema, 
  OAuthCallbackSchema, 
  SIWEAuthSchema 
} from './domain';
import { cookieUtils, oauthUtils } from './utils';

export function createAuthRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createRouteHandler = (
    handler: Function, 
    errorMessage: string,
    requireOriginCheck: boolean = false
  ) => {
    return async (c: any) => {
      try {
        if (requireOriginCheck) {
          const origin = c.req.header('origin') || c.req.header('referer');
          if (!origin?.startsWith(c.env.FRONTEND_URL)) {
            throw new Error('Invalid origin');
          }
        }

        const request = c.req.raw;
        const { ipAddress, userAgent } = getIPAndUserAgent(request);
        if (!ipAddress || !userAgent) {
          throw new Error('Missing IP address or user agent');
        }
        const encryptSecret= await c.env.ENCRYPTION_SECRET.get();
        if (!encryptSecret) {
          throw new Error("ENCRYPTION_SECRET is not defined in environment variables");
        }

        const sessionId = getSessionIdHash(ipAddress, userAgent, encryptSecret);

        return await handler(c, sessionId, ipAddress, userAgent);
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        cookieUtils.clearAuthCookies(c);
        return c.json(errorResponse, status);
      }
    };
  };

  // I. OAUTH Routes
  app.get('/oauth/:provider/url', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const provider = c.req.param('provider') as any;
    
    if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    const applicationService = createApplicationService(c, bindingName);
    const authUrl = await applicationService.getAuthUrlUseCase(provider, sessionId);

    return c.json({ url: authUrl });
  }, "Failed to get OAuth URL"));

  app.get('/oauth/:provider/callback', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const provider = c.req.param('provider') as any;
    
    if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    // Check for OAuth errors
    const error = c.req.query('error');
    if (error) {
      throw new Error(`OAuth error: ${error}`);
    }
    
    const queryParams = c.req.query();
    if (!queryParams.code || !queryParams.state) {
      throw new Error('Missing OAuth code or state');
    }
    const { code, state } = OAuthCallbackSchema.parse(c.req.query());

    if (!code || !state) {
      throw new Error('Missing OAuth code or state');
    }    

    const applicationService = createApplicationService(c, bindingName);

    // Exchange code for tokens and connect user
    const validatedUserInfo = await applicationService.exchangeOAuthCodeUseCase(provider, sessionId, state, code);
    const identifier = oauthUtils.normalizeOAuthIdentifier(provider, validatedUserInfo);
    
    const { token, refreshToken } = await applicationService.connectOAuthUseCase(
      sessionId, identifier, ipAddress, userAgent
    );

    cookieUtils.setAuthCookies(c, sessionId, token, refreshToken);
    return c.redirect(c.env.FRONTEND_URL);
  }, "OAuth callback failed", true));

  // II. OTP Routes
  app.post('/otp/request', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const { identifier } = await parseBody(c, OTPRequestSchema);
    
    const applicationService = createApplicationService(c, bindingName);
    await applicationService.getRequestOtpUseCase(identifier, sessionId);

    return c.json({ ok: true });
  }, "OTP request failed"));

  app.post('/otp/verify', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const { identifier, otp } = await parseBody(c, OTPVerificationSchema);
    
    const applicationService = createApplicationService(c, bindingName);
    const { token, refreshToken } = await applicationService.verifyOtpUseCase(
      identifier, sessionId, otp, ipAddress, userAgent
    );

    cookieUtils.setAuthCookies(c, sessionId, token, refreshToken);
    return c.json({ ok: true });
  }, "OTP verification failed", true));

  // III. Wallet Routes
  app.get('/wallet/nonce', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const applicationService = createApplicationService(c, bindingName);
    const nonce = await applicationService.generateNonceUseCase(sessionId);

    return c.json({ nonce });
  }, "Nonce request failed"));

  app.post('/wallet/connect', createRouteHandler(async (c: any, sessionId: string, ipAddress: string, userAgent: string) => {
    const { message, signature } = await parseBody(c, SIWEAuthSchema);
    
    const applicationService = createApplicationService(c, bindingName);
    const fields = await applicationService.verifySignatureUseCase(sessionId, message, signature);
    const address = fields.address.toLowerCase();

    const { token, refreshToken } = await applicationService.connectWalletUseCase(
      sessionId, address, ipAddress, userAgent
    );

    cookieUtils.setAuthCookies(c, sessionId, token, refreshToken);
    return c.json({ ok: true });
  }, "Wallet connection failed", true));

  // IV. Profile Routes
  app.post('/profile/logout', async (c) => {
    try {
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) throw new Error('Session not found');
      
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutUseCase(user.identifier, sessionId);
      
      cookieUtils.clearAuthCookies(c);
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = await handleError(c, e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });

  app.post('/profile/logoutAll', async (c) => {
    try {
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) throw new Error('Session not found');
      
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutAllUseCase(user.identifier);
      
      cookieUtils.clearAuthCookies(c);
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = await handleError(c, e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });

  app.get('/profile/me', async (c) => {
    try {
      const user = requireAuth(c);
      return c.json({ 
        id: user.id, 
        identifier: user.identifier, 
        address: user.address 
      });
    } catch (e) {
      const { errorResponse } = await handleError(c, e, "Get user info failed");
      return c.json(errorResponse, 401);
    }
  });

  return app;
}