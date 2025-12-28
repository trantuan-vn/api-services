import { z } from 'zod';

// Common schemas
const ImageFileSchema = z.instanceof(File).refine(
  (file) => ['image/jpeg', 'image/png'].includes(file.type),
  'Only JPEG and PNG images are supported'
);

// Base Options Schemas
const BaseOptionsSchema = z.object({
  maxTokens: z.number().min(50).max(2000).default(500),
});

const DocumentOptionsSchema = BaseOptionsSchema.extend({
  language: z.string().default('vi'),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
});

const FaceSearchOptionsSchema = BaseOptionsSchema.extend({
  detectionThreshold: z.number().min(0).max(1).default(0.7),
  maxFaces: z.number().min(1).max(50).default(10),
});

const FaceVerificationOptionsSchema = BaseOptionsSchema.extend({
  similarityThreshold: z.number().min(0).max(1).default(0.75),
  enableAttributes: z.boolean().default(true),
});

const LivenessOptionsSchema = BaseOptionsSchema.extend({
  detectionMode: z.enum(['strict', 'normal', 'relaxed']).default('normal'),
  spoofTypes: z.array(z.string()).default(['photo', 'screen', 'mask']),
});

// Base Request Schema
const BaseRequestSchema = z.object({
  endpoint: z.string(),
  ipAddress: z.string(),
  userAgent: z.string(),
  options: BaseOptionsSchema.default({}),
});

// Document Recognition Schemas
export const DocumentRecognitionSchema = BaseRequestSchema.extend({
  image: ImageFileSchema,
  docType: z.enum(['driver', 'cmt', 'cccd_front', 'cccd_back', 'passport', 'general']).default('general'),
  options: DocumentOptionsSchema.default({}),
});

export const DocumentExtractionResultSchema = z.object({
  documentType: z.string(),
  extractedData: z.record(z.any()),
  confidence: z.number().min(0).max(1),
  processingTime: z.number().optional(),
  metadata: z.object({
    imageSize: z.number().optional(),
    imageType: z.string().optional(),
  }).optional(),
});

// Face Detection Schemas
export const FaceSearchSchema = BaseRequestSchema.extend({
  image: ImageFileSchema,
  options: FaceSearchOptionsSchema.default({}),
});

export const FaceDetectionResultSchema = z.object({
  faces: z.array(z.object({
    boundingBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    confidence: z.number().min(0).max(1),
    landmarks: z.array(z.object({
      x: z.number(),
      y: z.number(),
      type: z.string(),
    })).optional(),
    attributes: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      emotions: z.array(z.string()).optional(),
    }).optional(),
  })),
  confidence: z.number().min(0).max(1),
  faceCount: z.number(),
  processingTime: z.number().optional(),
});

// Face Verification Schemas
export const FaceVerificationSchema = BaseRequestSchema.extend({
  image: ImageFileSchema,
  image2: ImageFileSchema.nullable(),
  options: FaceVerificationOptionsSchema.default({}),
});

export const FaceVerificationResultSchema = z.object({
  similarity: z.number().min(0).max(1),
  isMatch: z.boolean(),
  details: z.string(),
  confidence: z.number().min(0).max(1),
  attributes: z.object({
    image1: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      quality: z.number().optional(),
    }).optional(),
    image2: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      quality: z.number().optional(),
    }).optional(),
  }).optional(),
  processingTime: z.number().optional(),
});

// Liveness Detection Schemas
export const LivenessDetectionSchema = BaseRequestSchema.extend({
  image: ImageFileSchema,
  isVideo: z.boolean().default(false),
  options: LivenessOptionsSchema.default({}),
});

export const LivenessResultSchema = z.object({
  isLive: z.boolean(),
  details: z.string(),
  confidence: z.number().min(0).max(1),
  spoofType: z.string().optional(),
  riskScore: z.number().min(0).max(1).optional(),
  processingTime: z.number().optional(),
  recommendations: z.array(z.string()).optional(),
});

// Document prompts
export function getDocumentPrompt(docType: string): string {
  const prompts: Record<string, string> = {
    driver: 'Vietnamese Driver\'s License - return { name, license_number, dob, expiry, address } in Vietnamese.',
    cmt: 'Vietnamese CMND - return { full_name, id_number, dob, expire_date, place } in Vietnamese.',
    cccd_front: 'Vietnamese CCCD - return { full_name, id_number, dob, expire_date, address } in Vietnamese.',
    cccd_back: 'Vietnamese CCCD - return { issue_date, issue_address } in Vietnamese.',
    passport: 'Passport - return { full_name, passport_number, nationality, dob, expiry_date, issue_date }.'
  };

  const basePrompt = 'Extract structured data (JSON format) from this document image: ';
  return basePrompt + (prompts[docType] || 'General ID document - identify type and return { type, name, id_number, dob }.');
}

// Types
export type DocumentRecognition = z.infer<typeof DocumentRecognitionSchema>;
export type DocumentExtractionResult = z.infer<typeof DocumentExtractionResultSchema>;
export type FaceSearch = z.infer<typeof FaceSearchSchema>;
export type FaceDetectionResult = z.infer<typeof FaceDetectionResultSchema>;
export type FaceVerification = z.infer<typeof FaceVerificationSchema>;
export type FaceVerificationResult = z.infer<typeof FaceVerificationResultSchema>;
export type LivenessDetection = z.infer<typeof LivenessDetectionSchema>;
export type LivenessResult = z.infer<typeof LivenessResultSchema>;

// Domain Interfaces
export interface IAIDocumentService {
  recognizeDocument(request: DocumentRecognition): Promise<DocumentExtractionResult>;
  faceSearch(request: FaceSearch): Promise<FaceDetectionResult>;
  faceVerify(request: FaceVerification): Promise<FaceVerificationResult>;
  livenessDetection(request: LivenessDetection): Promise<LivenessResult>;
}