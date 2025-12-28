import { Hono } from 'hono';
import { createOrderApplicationService } from './application';
import { CreateOrderSchema, UpdateOrderStatusSchema, ORDER_DEFAULT_PAGE, ORDER_DEFAULT_LIMIT } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';

export function createOrderRoutes(bindingName: string) {
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
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Tạo đơn hàng mới
  app.post('/orders', createRouteHandler(async (c: any, user: any) => {
    const body = await c.req.json();
    const request = CreateOrderSchema.parse(body);
    const orderApp = createOrderApplicationService(c, bindingName);
    const result = await orderApp.createOrder(user, request);
    return c.json(result);
  }, 'Failed to create order'));

  // Lấy danh sách đơn hàng
  app.get('/orders', createRouteHandler(async (c: any, user: any) => {
    const status = c.req.query('status');
    const targetType = c.req.query('targetType') as 'SERVICE' | 'USER' | undefined;
    const page = parseInt(c.req.query('page') || ORDER_DEFAULT_PAGE);
    const limit = parseInt(c.req.query('limit') || ORDER_DEFAULT_LIMIT);
    const orderApp = createOrderApplicationService(c, bindingName);
    const result = await orderApp.getOrders(user.identifier, { status, targetType, page, limit });
    return c.json(result);
  }, 'Failed to get orders'));

  // Lấy chi tiết đơn hàng
  app.get('/orders/:orderId', createRouteHandler(async (c: any, user: any) => {
    const orderId = c.req.param('orderId');
    const orderApp = createOrderApplicationService(c, bindingName);
    const result = await orderApp.getOrderDetail(user.identifier, orderId);
    return c.json(result);
  }, 'Failed to get order detail'));

  // Cập nhật trạng thái đơn hàng
  app.patch('/orders/:orderId/status', createRouteHandler(async (c: any, user: any) => {
    const orderId = c.req.param('orderId');
    const body = await c.req.json();
    const request = UpdateOrderStatusSchema.parse(body);
    const orderApp = createOrderApplicationService(c, bindingName);
    const result = await orderApp.updateOrderStatus(user.identifier, orderId, request);
    return c.json(result);
  }, 'Failed to update order status'));

  // Hủy đơn hàng
  app.post('/orders/:orderId/cancel', createRouteHandler(async (c: any, user: any) => {
    const orderId = c.req.param('orderId');
    const orderApp = createOrderApplicationService(c, bindingName);
    const result = await orderApp.cancelOrder(user.identifier, orderId);
    return c.json(result);
  }, 'Failed to cancel order'));

  return app;
}