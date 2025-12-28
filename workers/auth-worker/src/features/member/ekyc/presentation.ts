import { Hono } from 'hono';
import { createDocumentAIService } from './application';
import { handleError, getIPAndUserAgent } from '../../../shared/utils';
import { processFormData } from './utils';
import { requirePermissions } from '../token/authMiddleware';
import { EKYC_SERVICES } from './constant';

export function createEkycRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createEkycRouteHandler = (
    servicePath: string,
    handler: Function,
    errorMessage: string
  ) => {
    return async (c: any) => {
      try {
        const fullUrl = new URL(c.req.url);
        const endpoint = fullUrl.pathname;
        
        if (endpoint !== servicePath) {
          throw new Error('Invalid endpoint');
        }

        const { ipAddress, userAgent } = getIPAndUserAgent(c.req.raw);
        if (!ipAddress || !userAgent) {
          throw new Error('Missing IP address or user agent');
        }

        const token = requirePermissions(c, [servicePath]);
        const aiService = createDocumentAIService(c, bindingName);
        
        return await handler(c, token, aiService, { endpoint, ipAddress, userAgent });
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Document recognition endpoint
  app.post('/recognize-document', createEkycRouteHandler(
    EKYC_SERVICES.DOCUMENT.RECOGNIZE.path,
    async (c: any, token: any, aiService: any, context: any) => {
      const { image, docType } = await processFormData(c);
      const result = await aiService.recognizeDocumentUseCase(token.identifier, { 
        image, 
        docType, 
        ...context 
      });
      return c.json(result);
    },
    'Document recognition failed'
  ));

  // Face search endpoint
  app.post('/face-search', createEkycRouteHandler(
    EKYC_SERVICES.FACE.SEARCH.path,
    async (c: any, token: any, aiService: any, context: any) => {
      const { image } = await processFormData(c);
      const result = await aiService.faceSearchUseCase(token.identifier, { 
        image, 
        ...context 
      });
      return c.json(result);
    },
    'Face search failed'
  ));

  // Face verification endpoint
  app.post('/face-verify', createEkycRouteHandler(
    EKYC_SERVICES.FACE.VERIFY.path,
    async (c: any, token: any, aiService: any, context: any) => {
      const { image, image2 } = await processFormData(c);
      
      if (!image2) {
        throw new Error('Missing second image for verification');
      }

      const result = await aiService.faceVerifyUseCase(token.identifier, { 
        image, 
        image2, 
        ...context 
      });
      return c.json(result);
    },
    'Face verification failed'
  ));

  // Liveness detection endpoint
  app.post('/face-liveness', createEkycRouteHandler(
    EKYC_SERVICES.FACE.LIVENESS.path,
    async (c: any, token: any, aiService: any, context: any) => {
      const { image, isVideo } = await processFormData(c);
      const result = await aiService.livenessDetectionUseCase(token.identifier, { 
        image, 
        isVideo, 
        ...context 
      });
      return c.json(result);
    },
    'Liveness detection failed'
  ));

  return app;
}