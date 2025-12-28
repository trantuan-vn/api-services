import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createAIService } from './infrastructure';
import { 
  DocumentRecognitionSchema,
  FaceSearchSchema,
  FaceVerificationSchema,
  LivenessDetectionSchema,
  DocumentExtractionResultSchema,
  FaceDetectionResultSchema,
  FaceVerificationResultSchema,
  LivenessResultSchema,
  DocumentExtractionResult,
  FaceDetectionResult,
  FaceVerificationResult,
  LivenessResult,
  IAIDocumentService
} from './domain';

interface IAIDocumentApplicationService {
  recognizeDocumentUseCase(identifier: string, request: any): Promise<DocumentExtractionResult>;
  faceSearchUseCase(identifier: string, request: any): Promise<FaceDetectionResult>;
  faceVerifyUseCase(identifier: string, request: any): Promise<FaceVerificationResult>;
  livenessDetectionUseCase(identifier: string, request: any): Promise<LivenessResult>;
}

export function createDocumentAIService(c: Context, bindingName: string): IAIDocumentApplicationService {
  
  const createUseCase = <T>(
    schema: any,
    resultSchema: any,
    method: keyof IAIDocumentService
  ) => {
    return async (identifier: string, request: any): Promise<T> => {
      const validatedRequest = schema.parse(request);
      const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
      const aiService = createAIService(c.env, userDO);
      const result = await aiService[method](validatedRequest);
      return resultSchema.parse(result);
    };
  };

  return {
    recognizeDocumentUseCase: createUseCase(
      DocumentRecognitionSchema,
      DocumentExtractionResultSchema,
      'recognizeDocument'
    ),
    faceSearchUseCase: createUseCase(
      FaceSearchSchema,
      FaceDetectionResultSchema,
      'faceSearch'
    ),
    faceVerifyUseCase: createUseCase(
      FaceVerificationSchema,
      FaceVerificationResultSchema,
      'faceVerify'
    ),
    livenessDetectionUseCase: createUseCase(
      LivenessDetectionSchema,
      LivenessResultSchema,
      'livenessDetection'
    )
  };
}