import { getDocumentPrompt } from './domain';

export const processFormData = async (c: any) => {
  const formData = await c.req.formData();
  const image = formData.get('image') as File;
  const image2 = formData.get('image2') as File | null;
  const docType = (formData.get('type') as string) || 'general';
  const isVideo = formData.has('video');

  if (!image) throw new Error('Missing image');
  if (!['image/jpeg', 'image/png'].includes(image.type)) {
    throw new Error('Invalid file type. Only JPEG/PNG images are supported.');
  }

  return { image, image2, docType, isVideo };
};

export async function toBase64(img: File): Promise<string> {
  try {
    const buffer = await img.arrayBuffer();
    return `data:${img.type};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch {
    throw new Error('Failed to process image');
  }
}

export function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch {
    return {};
  }
}

export function calculateConfidence(extractedData: any): number {
  const fields = Object.keys(extractedData).length;
  return Math.min(fields / 5, 0.95);
}

export function calculateFaceDetectionConfidence(faces: any[]): number {
  if (faces.length === 0) return 0;
  return faces.reduce((sum, face) => sum + (face.confidence || 0), 0) / faces.length;
}

export function calculateFaceVerificationConfidence(similarity: number): number {
  return Math.min(similarity * 1.2, 0.95);
}