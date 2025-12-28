import { Context } from 'hono';
import { getIdFromName, getIdFromString } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createApiTokenService } from './infrastructure';
import { 
  CreateApiToken,
  RevokeApiToken,
} from './domain';
import { TOKEN_CONSTANTS, ERROR_MESSAGES } from './constant';

interface ITokenApplicationService {
  // Token Management
  createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }>;
  revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }>;
  revokeAllApiTokensUseCase(identifier: string): Promise<{ success: boolean }>;
  getUserApiTokensUseCase(identifier: string): Promise<{ tokens: any[] }>;
  // Token Validation
  validateApiTokenUseCase(clientId: string, token: string): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }>;
}

export function createTokenApplicationService(c: Context, bindingName: string): ITokenApplicationService {
  const getTokenService = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    return createApiTokenService(c.env, userDO);
  };

  const getTokenServiceByClientId = (clientId: string) => {
    const userDO = getIdFromString(c, clientId, bindingName) as DurableObjectStub<UserDO>;
    return createApiTokenService(c.env, userDO);
  };

  return {
    async createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }> {
      const tokenService = getTokenService(identifier);
      const result = await tokenService.createApiToken(identifier, request);
      
      const response = {
        apiToken: {
          id: result.apiToken.id,
          name: result.apiToken.name,
          permissions: result.apiToken.permissions,
          expiresAt: result.apiToken.expiresAt,
          createdAt: result.apiToken.createdAt
        },
        rawToken: result.rawToken,
        warning: 'Store this token securely! It will not be shown again.'
      };

      return response;
    },

    async getUserApiTokensUseCase(identifier: string): Promise<{ tokens: any[] }> {
      const tokenService = getTokenService(identifier);
      const tokens = await tokenService.getUserApiTokens();
      return { tokens };
    },

    async revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }> {
      const tokenService = getTokenService(identifier);
      await tokenService.revokeApiToken(request.tokenId);
      return { success: true };
    },

    async revokeAllApiTokensUseCase(identifier: string): Promise<{ success: boolean }> {
      const tokenService = getTokenService(identifier);
      await tokenService.revokeAllApiTokens();
      return { success: true };
    },

    async validateApiTokenUseCase(clientId: string, token: string): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }> {
      const tokenService = getTokenServiceByClientId(clientId);
      return await tokenService.validateApiToken(token);
    }
  };
}