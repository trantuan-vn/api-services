import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createAuthMiddleware, createRateLimitMiddleware, securityHeadersMiddleware, createVersionCheckMiddleware } from './features/auth/authMiddleware';
import { createTokenValidationMiddleware, securityLoggingMiddleware } from './features/member/token/authMiddleware';
import { createAuthRoutes } from './features/auth/presentation';
import { createTokenRoutes } from './features/member/token/presentation';
import { createDashboardWebSocketRoutes, createApiWebSocketRoutes } from './features/ws/presentation';
import { createEkycRoutes } from './features/member/ekyc/presentation';
import { createOrderRoutes } from './features/member/order/presentation';
import { createPaymentRoutes } from './features/member/vnpay/presentation';
import { createPriceRoutes } from './features/admin/policy/presentation';
import { createServiceRoutes } from './features/admin/service/presentation';
import { createVoucherRoutes } from './features/admin/voucher/presentation';
import { createVersionRoutes } from './features/admin/version/presentation';


export { UserDO } from './features/ws/infrastructure/UserDO';
export { BroadcastServiceDO } from './features/ws/infrastructure/BroadcastServiceDO';
export { UserShardDO } from './features/ws/infrastructure/UserShardDO';

// I. CREATE ROUTES 
function createRoutes(bindingName: string) {
  const routes = new Hono<{ Bindings: Env }>();
  // routes.use('*', createRateLimitMiddleware()); 
  // Security headers
  routes.use('*', securityHeadersMiddleware());
  // CORS middleware (must come before auth middleware)
  routes.use('/*', cors({
      origin: [
        'https://beta.unitoken.trade',
        'https://www.beta.unitoken.trade',
        'https://unitoken.trade',
        'https://www.unitoken.trade',
        'https://sandbox.vnpayment.vn',
        'https://vnpayment.vn'
      ], 
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true, 
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));

  // I. DASHBOARD
  // Auth middleware
  routes.use('/dashboard/*', createAuthMiddleware(bindingName));  
  routes.use('/dashboard/*', createVersionCheckMiddleware(bindingName));  
    
  // sub routes /auth
  routes.route('/dashboard/auth', createAuthRoutes(bindingName));  
  routes.route('/dashboard/ws', createDashboardWebSocketRoutes(bindingName));  
  routes.route('/dashboard/token', createTokenRoutes(bindingName)); 
  routes.route('/dashboard/order', createOrderRoutes(bindingName));  
  routes.route('/dashboard/vnpay', createPaymentRoutes(bindingName));
  routes.route('/dashboard/admin/policy', createPriceRoutes(bindingName));
  routes.route('/dashboard/admin/service', createServiceRoutes(bindingName));
  routes.route('/dashboard/admin/voucher', createVoucherRoutes(bindingName));
  routes.route('/dashboard/admin/version', createVersionRoutes(bindingName));

  // II. API
  // Security middleware
  routes.use('/api/*', createTokenValidationMiddleware(bindingName));  
  routes.use('/api/*', createVersionCheckMiddleware(bindingName));
  routes.use('/api/*', securityLoggingMiddleware()); 
  // sub routes /api
  routes.route('/api/ekyc', createEkycRoutes(bindingName));
  routes.route('/api/ws', createApiWebSocketRoutes(bindingName));

  return routes;
}

const routeApp = createRoutes("USER_DO");

// III. CREATE MAIN APP
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return routeApp.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env, Error>;