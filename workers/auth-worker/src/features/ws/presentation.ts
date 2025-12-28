import { Hono } from 'hono';
import { requireAuth } from '../../features/auth/authMiddleware';
import { requirePermissions } from '../../features/member/token/authMiddleware';
import { createWebsocketApplicationService } from './application';
import { handleError } from '../../shared/utils';

export function createDashboardWebSocketRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // WebSocket connection endpoint
  app.get('/connect', async (c) => {
    try {
      const user = requireAuth(c);
      const wsApplicationService = createWebsocketApplicationService(c, bindingName);
      return wsApplicationService.connectWebSocketUseCase(user.identifier);

    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, "Failed to connect WebSocket");
      return c.json(errorResponse, status);
    }
  });

  // Broadcast message to all connected WebSocket clients (admin only)
  app.post('/broadcast', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const request = c.req.raw;
      const wsApplicationService = createWebsocketApplicationService(c, bindingName);
      return wsApplicationService.broadcastMessageUseCase(request);

    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, "Broadcast failed");
      return c.json(errorResponse, status);
    }
  });
  
  return app;
}

export function createApiWebSocketRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // WebSocket connection endpoint
  app.get('/connect', async (c) => {
    try {
      const token = requirePermissions(c, ['websocket:connect']);
      const wsApplicationService = createWebsocketApplicationService(c, bindingName);
      return wsApplicationService.connectWebSocketUseCase(token.identifier);

    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, "Failed to connect WebSocket");
      return c.json(errorResponse, status);
    }
  });

  return app;
}