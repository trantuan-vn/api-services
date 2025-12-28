import { Hono } from 'hono';
import { createVersionApplicationService } from './application';
import { requireAdmin, requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';
import { VersionIdSchema } from './domain';

export function createVersionRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createRouteHandler = (
    handler: Function, 
    errorMessage: string, 
    requireIsAdmin: boolean = false
  ) => {
    return async (c: any) => {
      try {
        const user = requireIsAdmin? requireAdmin(c) : requireAuth(c);
        return await handler(c, user);
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Lưu version mới - chỉ admin
  app.post('/save', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.saveNewVersion(user.identifier);
    return c.json(result);
  }, 'Failed to save new version', true));

  // Lấy danh sách các version - chỉ admin
  app.get('/list', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.getVersionList(user.identifier);
    return c.json(result);
  }, 'Failed to get version list', true));

  // Lấy dữ liệu version cụ thể
  app.get('/:versionId', createRouteHandler(async (c: any, user: any) => {
    const versionId = VersionIdSchema.parse(c.req.param('versionId'));
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.getVersionData(user.identifier, versionId);
    return c.json(result);
  }, 'Failed to get version data', true));

  // cap nhat version 
  app.get('/upgrade', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.upgradeVersion(user.identifier);
    return c.json(result);
  }, 'Failed to get current version'));



  return app;
}