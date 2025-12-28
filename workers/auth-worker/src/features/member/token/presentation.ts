import { Hono } from 'hono';
import { createTokenApplicationService } from './application';
import { CreateApiTokenSchema, RevokeApiTokenSchema } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';
import { ERROR_MESSAGES } from './constant';

export function createTokenRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createRouteHandler = (
    handler: Function, 
    errorMessage: string
  ) => {
    return async (c: any) => {
      try {
        const user = requireAuth(c);
        return await handler(c, user);
      } catch (error) {
        const { errorResponse, status } = await handleError(c, error, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Create new API token
  app.post('/create', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = CreateApiTokenSchema.parse(body);
    
    const tokenService = createTokenApplicationService(c, bindingName);
    const result = await tokenService.createApiTokenUseCase(user.identifier, request);
    return c.json(result);
  }, "Failed to create API token"));

  // Get all user API tokens
  app.get('/list', createRouteHandler(async (c: any, user: any) => {
    const tokenService = createTokenApplicationService(c, bindingName);
    const result = await tokenService.getUserApiTokensUseCase(user.identifier);
    return c.json(result);
  }, "Failed to get API tokens"));

  // Revoke specific API token
  app.delete('/revoke/:tokenId', createRouteHandler(async (c: any, user: any) => {
    const tokenId = c.req.param('tokenId');
    const request = RevokeApiTokenSchema.parse({ tokenId });
    
    const tokenService = createTokenApplicationService(c, bindingName);
    const result = await tokenService.revokeApiTokenUseCase(user.identifier, request);
    return c.json(result);
  }, "Failed to revoke API token"));

  // Revoke all API tokens
  app.delete('/revoke-all', createRouteHandler(async (c: any, user: any) => {
    const tokenService = createTokenApplicationService(c, bindingName);
    const result = await tokenService.revokeAllApiTokensUseCase(user.identifier);
    return c.json(result);
  }, "Failed to revoke all API tokens"));
  
  return app;
}