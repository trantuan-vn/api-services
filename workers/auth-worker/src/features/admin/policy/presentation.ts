import { Hono } from 'hono';
import { createPriceApplicationService } from './application';
import { PricePolicySchema, PolicyIdSchema, StatusSchema } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';

export function createPriceRoutes(bindingName: string) {
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

  // Tạo chính sách giá mới
  app.post('/policies', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = PricePolicySchema.parse(body);
    const priceApp = createPriceApplicationService(c, bindingName);
    const result = await priceApp.createPricePolicy(user.identifier, request);
    return c.json(result);
  }, 'Failed to create price policy'));

  // Cập nhật chính sách giá
  app.put('/policies/:policyId', createRouteHandler(async (c: any, user: any) => {
    const policyId = PolicyIdSchema.parse(c.req.param('policyId'));
    const body = await c.req.json();
    const request = PricePolicySchema.parse(body);
    const priceApp = createPriceApplicationService(c, bindingName);
    const result = await priceApp.updatePricePolicy(user.identifier, policyId, request);
    return c.json(result);
  }, 'Failed to update price policy'));

  // Lấy danh sách chính sách giá
  app.get('/policies', createRouteHandler(async (c: any, user: any) => {
    const status = c.req.query('status') as 'ACTIVE' | 'INACTIVE' | undefined;
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const priceApp = createPriceApplicationService(c, bindingName);
    const result = await priceApp.getPricePolicies(user.identifier, limit, offset, status);
    return c.json(result);
  }, 'Failed to get price policies'));

  // Lấy chi tiết chính sách giá
  app.get('/policies/:policyId', createRouteHandler(async (c: any, user: any) => {
    const policyId = PolicyIdSchema.parse(c.req.param('policyId'));
    const priceApp = createPriceApplicationService(c, bindingName);
    const result = await priceApp.getPricePolicy(user.identifier, policyId);
    return c.json(result);
  }, 'Failed to get price policy'));

  // Xóa chính sách giá
  app.delete('/policies/:policyId', createRouteHandler(async (c: any, user: any) => {
    const policyId = PolicyIdSchema.parse(c.req.param('policyId'));
    const priceApp = createPriceApplicationService(c, bindingName);
    await priceApp.deletePricePolicy(user.identifier, policyId);
    return c.json({ success: true });
  }, 'Failed to delete price policy'));
  // Kích hoạt/vô hiệu hóa chính sách giá
  app.patch('/policies/:policyId/status', createRouteHandler(async (c: any, user: any) => {
    const policyId = PolicyIdSchema.parse(c.req.param('policyId'));
    const body = await c.req.json();    
    const validatedStatus = StatusSchema.parse(body.status);    
    const priceApp = createPriceApplicationService(c, bindingName);
    const result = await priceApp.updatePolicyStatus(user.identifier, policyId, validatedStatus);
    return c.json(result);
  }, 'Failed to update policy status'));

  // Tính toán giá không yêu cầu admin
  const createCalculateHandler = (type: 'service' | 'user') => 
    createRouteHandler(async (c: any, user: any) => {
      const body = await c.req.json();
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = type === 'service' 
        ? await priceApp.calculateServicePrice(user.identifier, body)
        : await priceApp.calculateUserPrice(user.identifier, body);
      return c.json(result);
    }, `Failed to calculate ${type} price`, false);

  app.post('/calculate/service', createCalculateHandler('service'));
  app.post('/calculate/user', createCalculateHandler('user'));


  return app;
}