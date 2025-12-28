import { Hono } from 'hono';
import { createServiceApplicationService } from './application';
import { ServiceSchema } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';

export function createServiceRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createRouteHandler = (
    handler: Function, 
    errorMessage: string, 
    requireAdmin: boolean = true
  ) => {
    return async (c: any) => {
      try {
        const user = requireAuth(c);
        if (requireAdmin && user.role !== 'admin') {
          throw new Error('Insufficient permissions');
        }
        return await handler(c, user);
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Đăng ký dịch vụ
  app.post('/register', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = ServiceSchema.parse(body);
    const serviceApp = createServiceApplicationService(c, bindingName);
    const result = await serviceApp.registerService(user.identifier, request);
    return c.json(result);
  }, 'Failed to register service'));

  // Lấy danh sách dịch vụ
  app.get('/list', createRouteHandler(async (c: any, user: any) => {
    const serviceApp = createServiceApplicationService(c, bindingName);
    const result = await serviceApp.getUserServices(user.identifier);
    return c.json(result);
  }, 'Failed to get services'));

  // Hủy dịch vụ
  app.delete('/cancel/:serviceId', createRouteHandler(async (c: any, user: any) => {
    const serviceId = c.req.param('serviceId');
    const serviceApp = createServiceApplicationService(c, bindingName);
    await serviceApp.cancelService(user.identifier, serviceId);
    return c.json({ success: true });
  }, 'Failed to cancel service'));

  // Lấy lịch sử sử dụng dịch vụ
  app.get('/usage/:serviceId', createRouteHandler(async (c: any, user: any) => {
    const serviceId = c.req.param('serviceId');
    const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30;
    const serviceApp = createServiceApplicationService(c, bindingName);
    const result = await serviceApp.getServiceUsage(user.identifier, serviceId, days);
    return c.json(result);
  }, 'Failed to get service usage'));

  return app;
}