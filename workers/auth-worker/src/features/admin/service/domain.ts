import { z } from 'zod';

// Schemas
export const ServiceSchema = z.object({
  name: z.string().min(1).max(100),
  endpoint: z.string(),
  maxCalls: z.number().min(0).default(0),
  currentCalls: z.number().min(0).default(0),
  expiresAt: z.preprocess(
    (val) => {
      // Xử lý cả string số và number
      const num = Number(val);
      
      if (!isNaN(num)) {
        const date = new Date();
        
        // Phân biệt: số nhỏ là ngày, số lớn là timestamp
        if (num < 10000) { // Giả sử < 10000 là số ngày
          // Giới hạn tối đa 360 ngày nếu cần
          const daysToAdd = num > 360 ? 360 : num;
          date.setDate(date.getDate() + daysToAdd);
          return date.toISOString();
        } else {
          // Số lớn: coi như timestamp
          return new Date(num).toISOString();
        }
      }
      
      return val;
    },
    z.string().datetime().optional()
  ),
  isActive: z.boolean().default(true),
});

export const ServiceUsageSchema = z.object({
  serviceId: z.number().int(),
  endpoint: z.string(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
});

export const ServiceIdSchema = z.string().uuid();

// Types
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceUsage = z.infer<typeof ServiceUsageSchema>;

// Domain Interfaces
export interface IServiceInfrastructureService {
  registerService(request: Service): Promise<any>;
  getUserServices(): Promise<any[]>;
  cancelService(serviceId: string): Promise<void>;
  getServiceUsage(serviceId: string, days?: number): Promise<any[]>;
}