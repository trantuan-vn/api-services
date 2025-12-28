import { Hono } from 'hono';
import { createVoucherApplicationService } from './application';
import { VoucherSchema, ApplyVoucherSchema, VoucherStatusSchema } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';

export function createVoucherRoutes(bindingName: string) {
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

  // Tạo voucher mới
  app.post('/vouchers', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = VoucherSchema.parse(body);
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.createVoucher(user.identifier, request);
    return c.json(result);
  }, 'Failed to create voucher'));

  // Áp dụng voucher vào service
  app.post('/apply/service', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = ApplyVoucherSchema.parse(body);
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.applyServiceVoucher(user.identifier, request);
    return c.json(result);
  }, 'Failed to apply voucher to service', false));

  // Áp dụng voucher cho user
  app.post('/apply/user', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = ApplyVoucherSchema.parse(body);
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.applyUserVoucher(user.identifier, request);
    return c.json(result);
  }, 'Failed to apply voucher to user', false));

  // Lấy danh sách voucher
  app.get('/vouchers', createRouteHandler(async (c: any, user: any) => {
    const status = c.req.query('status') as 'ACTIVE' | 'INACTIVE' | undefined;
    const targetType = c.req.query('targetType') as 'SERVICE' | 'USER' | undefined;
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.getVouchers(user.identifier, status, targetType);
    return c.json(result);
  }, 'Failed to get vouchers'));

  // Lấy thông tin voucher bằng code
  app.get('/code/:voucherCode', createRouteHandler(async (c: any, user: any) => {
    const voucherCode = c.req.param('voucherCode');
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.getVoucherByCode(user.identifier, voucherCode);
    return c.json(result);
  }, 'Failed to get voucher'));

  // Validate voucher cho service
  app.post('/validate/service', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.validateServiceVoucher(user.identifier, body);
    return c.json(result);
  }, 'Failed to validate service voucher', false));

  // Validate voucher cho user
  app.post('/validate/user', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.validateUserVoucher(user.identifier, body);
    return c.json(result);
  }, 'Failed to validate user voucher', false));

  // Hủy/vô hiệu hóa voucher
  app.patch('/vouchers/:voucherId/status', createRouteHandler(async (c: any, user: any) => {
    const voucherId = c.req.param('voucherId');
    const body = await c.req.json();
    const validatedStatus = VoucherStatusSchema.parse(body.status);
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.updateVoucherStatus(user.identifier, voucherId, validatedStatus);
    return c.json(result);
  }, 'Failed to update voucher status'));

  // Lấy vouchers khả dụng cho service
  app.get('/available/services', createRouteHandler(async (c: any, user: any) => {
    const serviceId = c.req.query('serviceId');
    const basePrice = parseFloat(c.req.query('basePrice') || '0');
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.getAvailableServiceVouchers(user.identifier, serviceId, basePrice);
    return c.json(result);
  }, 'Failed to get available service vouchers', false));

  // Lấy vouchers khả dụng cho user
  app.get('/available/users', createRouteHandler(async (c: any, user: any) => {
    const basePrice = parseFloat(c.req.query('basePrice') || '0');
    const voucherApp = createVoucherApplicationService(c, bindingName);
    const result = await voucherApp.getAvailableUserVouchers(user.identifier, user.id, user.role, basePrice);
    return c.json(result);
  }, 'Failed to get available user vouchers', false));

  return app;
}