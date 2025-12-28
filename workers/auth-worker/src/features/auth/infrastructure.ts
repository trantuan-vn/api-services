import { UserDO } from '../ws/infrastructure/UserDO';
import { SiweMessage, generateNonce } from 'siwe';

import { 
  UserSchema, 
  IUserRepository, 
  IOTPService, 
  IWalletService, 
  IOAuthService, 
  IKvService,
  OAuthTokenResponse,
  OAuthTokenResponseSchema,
  GoogleUserInfoSchema, 
  AppleUserInfoSchema, 
  FacebookUserInfoSchema, 
  GitHubUserInfoSchema, 
  TwitterUserInfoSchema,
  Session, 
  SessionSchema, 
  ISessionRepository
} from './domain';
import { AUTH_CONSTANTS, ERROR_MESSAGES } from './constant';
import { oauthUtils, otpUtils } from './utils';

import { executeUtils } from '../../shared/utils';

// User Repository Implementation
const createUserRepository = (userDO: DurableObjectStub<UserDO>): IUserRepository => ({
  async get(): Promise<any> {
    const user = await executeUtils.executeDynamicAction(userDO, 'select', {}, 'users')
    return user[0] || null;
  },

  async save(user: any): Promise<any> {
    const validationResult = UserSchema.parse(user);
    const existingUser = await this.get();
    
    const operation = existingUser ? 'update' : 'insert';
    const payload = existingUser? {
                                    ...validationResult,
                                    id: existingUser.id
                                  }
                                : validationResult
    
    return await executeUtils.executeDynamicAction(userDO, operation, payload, 'users');
  },

  async delete(): Promise<void> {
    const user = await this.get();
    if (!user) return;

    await executeUtils.executeDynamicAction(userDO, 'delete', { id: user.id }, 'users');
  },
});

// Session Repository Implementation
const createSessionRepository = (userDO: DurableObjectStub<UserDO>): ISessionRepository => ({
  async create(sessionData: Session): Promise<any> {
    const validSession = SessionSchema.parse(sessionData);
    return await executeUtils.executeDynamicAction(userDO, 'upsert', validSession, 'sessions');
  },

  async findById(sessionId: string): Promise<any> {
    const session = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "hashSessionId", operator: '=', value: sessionId },
          { field: "isActive", operator: '=', value: 1 }
        ]
      }, 'sessions')    
    return session[0] || null;
  },

  async update(sessionId: string, sessionData: Partial<Session>): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session) {
      throw new Error(ERROR_MESSAGES.AUTH.SESSION_NOT_FOUND);
    }    
    const updatedData = {
      id: session.id,
      ...sessionData
    };
    await executeUtils.executeDynamicAction(userDO, 'update', updatedData, 'sessions');

  },

  async delete(sessionId: string): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session) {
      throw new Error(ERROR_MESSAGES.AUTH.SESSION_NOT_FOUND);
    }    
    await executeUtils.executeDynamicAction(userDO, 'delete', { id: session.id }, 'sessions');
  },

  async deactivateAllUserSessions(identifier: string): Promise<void> {
    await executeUtils.executeTransaction(userDO, [
      {
        sql: 'UPDATE sessions SET isActive = 0 WHERE user_id IN (SELECT user_id FROM users WHERE identifier = ?)',
        params: [identifier]
      }
    ]);
  },
});

// Main Repository Factory
export function createRepository(userDO: DurableObjectStub<UserDO>) {
  return {
    users: createUserRepository(userDO),
    sessions: createSessionRepository(userDO),
  };
}

// KV Service Implementation
export function createKvService(env: Env): IKvService {
  const saveNonceData = async (key: string, nonce: string): Promise<void> => {
    const nonceData = { nonce };
    await env.NONCE_KV.put(key, JSON.stringify(nonceData), {
      expirationTtl: AUTH_CONSTANTS.NONCE_EXPIRY,
    });
  };

  const validateNonceData = async (key: string, nonce: string): Promise<boolean> => {
    // Lấy và xóa atomically nếu có thể
    const nonceStr = await env.NONCE_KV.get(key);
    if (!nonceStr) throw new Error(ERROR_MESSAGES.AUTH.INVALID_OTP);

    const nonceData = JSON.parse(nonceStr);
    const isValid = nonceData.nonce === nonce;

    if (isValid) {
      // Xóa nonce ngay lập tức để tránh reuse
      await env.NONCE_KV.delete(key);
    }

    return isValid;
  };

  return {
    async saveNonce(sessionId: string, nonce: string): Promise<void> {
      await saveNonceData(`Nonce:${sessionId}`, nonce);
    },

    async validateNonce(sessionId: string, nonce: string): Promise<boolean> {
      return await validateNonceData(`Nonce:${sessionId}`, nonce);
    }
  };
}

// OTP Service Implementation
export function createOTPService(env: Env): IOTPService {
  const kvService = createKvService(env);
  
  const sendEmail = async (email: string, otp: string): Promise<void> => {
    const emailApiKey= await env.EMAIL_API_KEY.get();
    if (!emailApiKey) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }

    const emailData = {
      personalizations: [{ to: [{ email }], subject: "Your OTP Code" }],
      from: { email: "noreply@unitoken.trade", name: "Unitoken Auth" },
      content: [{
        type: "text/html",
        value: `
          <h2>Your OTP Code</h2>
          <p>Your one-time password is: <strong>${otp}</strong></p>
          <p>This code will expire in 10 minutes.</p>
        `
      }],
    };

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${emailApiKey}`,
      },
      body: JSON.stringify(emailData),
    });

    if (!response.ok) {
      throw new Error(`Failed to send email OTP: ${await response.text()}`);
    }
  };

  const sendSMS = async (phone: string, otp: string, provider: string): Promise<void> => {
    let response: Response | null = null;
    const accountId= await env.TWILIO_ACCOUNT_SID.get();
    const authToken= await env.TWILIO_AUTH_TOKEN.get();
    if (!accountId || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not defined in environment variables");
    }
    const apiKey= await env.VONAGE_API_KEY.get();
    const apiSecret= await env.VONAGE_API_SECRET.get();
    if (!accountId || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not defined in environment variables");
    }



    switch (provider.toUpperCase()) {
      case "TWILIO": {
        const smsData = new URLSearchParams({
          To: phone,
          From: env.SMS_FROM_NUMBER,
          Body: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
        });

        const auth = btoa(`${accountId}:${authToken}`);
        response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountId}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: smsData.toString(),
          }
        );
        break;
      }
      case "VONAGE": {
        const smsData = new URLSearchParams({
          from: env.SMS_FROM_NUMBER,
          to: phone,
          text: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
        });

        const auth = btoa(`${apiKey}:${apiSecret}`);
        response = await fetch("https://rest.nexmo.com/sms/json", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: smsData.toString(),
        });
        break;
      }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    if (response && !response.ok) {
      throw new Error(`Failed to send SMS OTP via ${provider}: ${await response.text()}`);
    }
  };

  return {
    async generateOTP(sessionId: string): Promise<string> {
      const otp = otpUtils.generateOTP();
      await kvService.saveNonce(sessionId, otp);
      return otp;
    },

    async verifyOTP(otp: string, sessionId: string): Promise<boolean> {
      return await kvService.validateNonce(sessionId, otp);
    },

    async sendEmailOTP(email: string, otp: string): Promise<void> {
      await sendEmail(email, otp);
    },

    async sendSmsOTP(phone: string, otp: string, provider: string): Promise<void> {
      await sendSMS(phone, otp, provider);
    }
  };
}

// Wallet Service Implementation
export function createWalletService(env: Env): IWalletService {
  const kvService = createKvService(env);
  const validateSiweFields= async (
    fields: SiweMessage, 
    options: {
      expectedDomain?: string;
      expectedOrigin?: string;
      maxMessageAge?: number; // Thay thế maxExpirationHours
    }
  ): Promise<void> => {
    const {
      expectedDomain,
      expectedOrigin,
      maxMessageAge = 5 * 60 * 1000, // 5 minutes default
    } = options;

    const now = new Date();

    // 1. Validate domain (QUAN TRỌNG)
    if (expectedDomain && fields.domain !== expectedDomain) {
      throw new Error(`Invalid domain: expected ${expectedDomain}, got ${fields.domain}`);
    }

    // 2. Validate URI/origin
    if (expectedOrigin && fields.uri !== expectedOrigin) {
      throw new Error(`Invalid URI: expected ${expectedOrigin}, got ${fields.uri}`);
    }

    // 3. Validate statement exists
    if (!fields.statement || typeof fields.statement !== 'string') {
      throw new Error('Missing authentication statement');
    }

    // 4. Validate message age (thay thế expiration time)
    const issuedAt = new Date(fields.issuedAt || 0);
    const messageAge = now.getTime() - issuedAt.getTime();
    
    if (messageAge > maxMessageAge) {
      throw new Error(`Message is too old: ${Math.round(messageAge / 1000)} seconds`);
    }

    // 5. Validate issuedAt is not in the future (allow small clock skew)
    if (issuedAt > new Date(now.getTime() + 2 * 60 * 1000)) { // 2 minutes clock skew
      throw new Error('Message issued in the future');
    }

    // 6. Validate version
    if (fields.version !== '1') {
      throw new Error(`Unsupported version: ${fields.version}`);
    }

    // 7. Validate chainId (optional)
    if (fields.chainId !== 1) { // Chỉ cho phép Ethereum mainnet
      throw new Error(`Unsupported chain: ${fields.chainId}`);
    }

    // 8. Validate address format
    if (!fields.address || !fields.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error('Invalid Ethereum address');
    }
  }
  
  return {
    async generateNonceAndStore(sessionId: string): Promise<string> {
      const nonce = generateNonce();
      await kvService.saveNonce(sessionId, nonce);
      return nonce;
    },

    async verifySignature(
      sessionId: string, 
      message: string, 
      signature: string,
      expectedDomain: string = 'unitoken.trade',
      expectedOrigin: string = 'https://unitoken.trade'
    ): Promise<SiweMessage> {
      // 1. Parse message
      let siweMessage: SiweMessage;
      siweMessage = new SiweMessage(message);

      // 2. Validate signature format
      const sig = signature.startsWith('0x') ? signature : `0x${signature}`;
      if (!sig.match(/^0x[a-fA-F0-9]{130}$/)) {
        throw new Error('Invalid signature format');
      }

      // 3. Verify signature với nonce constraint
      const verificationResult = await siweMessage.verify({ signature: sig });

      if (!verificationResult.success) {
        throw new Error(`Signature verification failed: ${verificationResult.error}`);
      }
      
      const { data: fields } = verificationResult;

      const isValid= await kvService.validateNonce(sessionId, fields.nonce);
      if (!isValid) {
        throw new Error('Invalid nonce');
      }

      // 4. Validate additional fields
      await validateSiweFields(fields, {
        expectedDomain,
        expectedOrigin,
        maxMessageAge: 10 * 60 * 1000, // 10 minutes max age
      });

      return fields;
    }
  };
}

// OAuth Service Implementation
export function createOAuthService(env: Env): IOAuthService {
  const kvService = createKvService(env);

  const exchangeCodeForToken = async (code: string, config: any): Promise<OAuthTokenResponse> => {
    const params = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const tokenData = await response.json();
    return OAuthTokenResponseSchema.parse(tokenData);
  };

  const fetchUserInfo = async (provider: string, accessToken: string, config: any): Promise<any> => {
    const response = await fetch(config.userInfoEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Unitoken-Auth',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get user info from ${provider}: ${response.status} ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Unexpected response format from ${provider}: ${contentType}`);
    }

    const userInfo = await response.json();

    const schemaMap: Record<string, any> = {
      google: GoogleUserInfoSchema,
      apple: AppleUserInfoSchema,
      facebook: FacebookUserInfoSchema,
      github: GitHubUserInfoSchema,
      twitter: TwitterUserInfoSchema,
    };

    const schema = schemaMap[provider];
    if (!schema) throw new Error(`Unsupported provider: ${provider}`);

    return schema.parse(userInfo);
  };

  return {
    async generateState(sessionId: string): Promise<string> {
      const state = generateNonce();
      await kvService.saveNonce(sessionId, state);
      return state;
    },

    async exchangeOAuthCode(provider: string, sessionId: string, state: string, code: string): Promise<OAuthTokenResponse> {
      const isValidNonce = await kvService.validateNonce(sessionId, state);
      if (!isValidNonce) {
        throw new Error('Invalid OAuth state');
      }

      const config = await oauthUtils.getOAuthConfig(provider, env);
      return await exchangeCodeForToken(code, config);
    },

    async getUserInfoFromProvider(provider: string, accessToken: string): Promise<any> {
      const config = await oauthUtils.getOAuthConfig(provider, env);
      return await fetchUserInfo(provider, accessToken, config);
    }
  };
}