import { 
  DocumentRecognition, 
  FaceSearch, 
  FaceVerification, 
  LivenessDetection,
  DocumentExtractionResult,
  FaceDetectionResult,
  FaceVerificationResult,
  LivenessResult,
  IAIDocumentService
} from './domain';
import { toBase64, safeJsonParse, calculateConfidence, 
  calculateFaceDetectionConfidence, calculateFaceVerificationConfidence } from './utils';
import { getDocumentPrompt } from './domain';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { executeUtils } from '../../../shared/utils';
export function createAIService(env: Env, userDO: DurableObjectStub<UserDO>): IAIDocumentService {

  const validateServiceUsage = async (endpoint: string): Promise<any> => {
     
    const service = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "endpoint", operator: '=', value: endpoint },
          { field: "isActive", operator: '=', value: 1 }
        ]
      }, 'services').then(results => results[0]);

    if (!service) {
      throw new Error('Service not found');
    }

    if (service.currentCalls >= service.maxCalls) {
      throw new Error('Service quota exceeded');
    }

    return service;
  };
  const updateServiceUsage = async (
    service: any, 
    endpoint: string, 
    request: any
  ): Promise<void> => {
    const transactionResponse = 
      await executeUtils.executeDynamicAction
        (
          userDO, 
          'multi-table', 
          [
            {
              table: 'services',
              operation: 'update',
              id: service.id,
              data: {
                currentCalls: service.currentCalls + 1,
              }
            },
            {
              table: 'service_usages',
              operation: 'insert',
              data: {
                serviceId: service.id,
                endpoint: endpoint,
                userAgent: request.userAgent,
                ipAddress: request.ipAddress,
              }
            }
          ]
        );

    if (!transactionResponse.ok) {
      throw new Error(`Failed to update service usage: ${transactionResponse.statusText}`);
    }
  };

  const executeAIModel = async ( 
    endpoint: string,
    request: any,
    prompt: string,
    images: File[],
    processResult: (response: any, service: any) => Promise<any>
  ): Promise<any> => {
    // Validate and update service usage
    const service = await validateServiceUsage(endpoint);
    if (!service) {
      throw new Error('Service not found');
    }

    // Process images and prepare AI request
    const imagePromises = images.map(img => toBase64(img));
    const imageB64s = await Promise.all(imagePromises);

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...imageB64s.map(image => ({ type: 'image', image }))
      ]
    }];

    // Execute AI model
    const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      messages,
      max_tokens: request.options.maxTokens,
    });

    // Process result and update service usage
    return await processResult(response, service);
  };

  const processDocumentRecognition = async (
    response: any, 
    service: any,
    request: DocumentRecognition
  ): Promise<DocumentExtractionResult> => {

    const extractedData = safeJsonParse(response.response || '{}');
    const returnData = {
      documentType: request.docType,
      extractedData,
      confidence: calculateConfidence(extractedData),
      processingTime: Date.now(),
      metadata: {
        imageSize: request.image.size,
        imageType: request.image.type
      }
    };
    // Update service usage
    await updateServiceUsage(service, request.endpoint, request);

    return returnData;
  };

  const processFaceSearch = async (
    response: any, 
    service: any,
    request: FaceSearch
  ): Promise<FaceDetectionResult> => {

    const facesData = safeJsonParse(response.response || '[]');
    const faces = Array.isArray(facesData) ? facesData : [facesData];
    
    const returnData = {
      faces: faces.map((face: any) => ({
        boundingBox: face.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
        confidence: face.confidence || request.options.detectionThreshold,
        landmarks: face.landmarks || [],
        attributes: face.attributes || {}
      })),
      confidence: calculateFaceDetectionConfidence(faces),
      faceCount: faces.length,
      processingTime: Date.now()
    };
    // Update service usage
    await updateServiceUsage(service, request.endpoint, request);

    return returnData;
  };

  const processFaceVerification = async (
    response: any, 
    service: any,
    request: FaceVerification
  ): Promise<FaceVerificationResult> => {

    const result = safeJsonParse(response.response || '{"similarity": 0, "isMatch": false}');
    const similarity = result.similarity || 0;
    const isMatch = similarity >= request.options.similarityThreshold;
    
    const returnData = {
      similarity,
      isMatch,
      details: result.description || 'No description provided',
      confidence: calculateFaceVerificationConfidence(similarity),
      attributes: result.attributes || {},
      processingTime: Date.now()
    };
    // Update service usage
    await updateServiceUsage(service, request.endpoint, request);

    return returnData;
  };

  const processLivenessDetection = async (
    response: any, 
    service: any,
    request: LivenessDetection
  ): Promise<LivenessResult> => {
    // Update service usage
    await updateServiceUsage(service, request.endpoint, request);

    const result = safeJsonParse(response.response || '{"isLive": false, "details": "No liveness detected", "riskScore": 0.8}');
    
    const returnData =  {
      isLive: result.isLive || false,
      details: result.details || 'No details provided',
      confidence: 1 - (result.riskScore || 0.8),
      spoofType: result.spoofType,
      riskScore: result.riskScore,
      processingTime: Date.now(),
      recommendations: result.recommendations || []
    };
    // Update service usage
    await updateServiceUsage(service, request.endpoint, request);

    return returnData;
  };

  return {
    async recognizeDocument(request: DocumentRecognition): Promise<DocumentExtractionResult> {
      return executeAIModel(
        request.endpoint,
        request,
        getDocumentPrompt(request.docType),
        [request.image],
        (response, service) => processDocumentRecognition(response, service, request)
      );
    },

    async faceSearch(request: FaceSearch): Promise<FaceDetectionResult> {
      return executeAIModel(
        request.endpoint,
        request,
        'Detect faces in this image. Return the number of faces and their bounding boxes (x, y, width, height) in JSON format.',
        [request.image],
        (response, service) => processFaceSearch(response, service, request)
      );
    },

    async faceVerify(request: FaceVerification): Promise<FaceVerificationResult> {
      if (!request.image2) {
        throw new Error('Second image required for verification');
      }

      return executeAIModel(
        request.endpoint,
        request,
        'Compare two faces in these images. Return a JSON object with { similarity: number (0-1), isMatch: boolean, description: string }.',
        [request.image, request.image2],
        (response, service) => processFaceVerification(response, service, request)
      );
    },

    async livenessDetection(request: LivenessDetection): Promise<LivenessResult> {
      const prompt = request.isVideo
        ? 'Analyze this image as a video frame for liveness detection. Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.'
        : 'Analyze this image to detect if it is a live face or a spoof. Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.';

      return executeAIModel(
        request.endpoint,
        request,
        prompt,
        [request.image],
        (response, service) => processLivenessDetection(response, service, request)
      );
    }
  };
}