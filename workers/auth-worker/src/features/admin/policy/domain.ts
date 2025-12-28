import { z } from 'zod';

// Schemas
export const PricePolicySchema = z.object({
  name: z.string().min(1).max(300),
  code: z.string().min(3).max(50),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'TIERED', 'USAGE_BASED']),
  value: z.number().min(0),
  applicableTo: z.enum(['ALL', 'SPECIFIC']),
  targetType: z.enum(['SERVICE', 'USER']),
  targetIds: z.array(z.number()).optional(),
  conditions: z.object({
    userRoles: z.array(z.enum(['member', 'admin'])).optional(),
    maxCalls: z.number().min(0).optional(),
    minQuantity: z.number().min(1).optional(),
    usagePercentage: z.number().min(0).max(100).optional(),
    tiers: z.array(z.object({
      minAmount: z.number().optional(),
      minUsage: z.number().optional(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
  }).optional(),
  priority: z.number().min(0).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  expiresAt: z.preprocess(
    (val: unknown) => {
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
});

export const PriceCalculationRequestSchema = z.object({
  basePrice: z.number().min(0),
  userId: z.number().int(),
  userRole: z.enum(['member', 'admin']).optional(),
  serviceId: z.number().int(),
  serviceName: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  maxCalls: z.number().min(0).optional(),
  quantity: z.number().min(1).optional().default(1),
  currency: z.string().optional().default('VND'),
});
export const PolicyIdSchema = z.number(); // hoặc regex phù hợp
export const StatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
// Types
export type PricePolicy = z.infer<typeof PricePolicySchema>;
export type PriceCalculationRequest = z.infer<typeof PriceCalculationRequestSchema>;

// Domain Interfaces
export interface IPriceInfrastructureService {
  createPricePolicy(request: PricePolicy): Promise<any>;
  updatePricePolicy(policyId: number, request: PricePolicy): Promise<any>;
  getPricePolicies(limit: number, offset: number, status?: string): Promise<any[]>;
  getPricePolicy(policyId: number): Promise<any>;
  deletePricePolicy(policyId: number): Promise<void>;
  calculateServicePrice(request: Partial<PriceCalculationRequest>): Promise<any>;
  calculateUserPrice(request: Partial<PriceCalculationRequest>): Promise<any>;
  updatePolicyStatus(policyId: number, status: string): Promise<any>;
}

// Ví dụ sử dụng:
// {
//   "name": "Giảm 10% cho Service API",
//   "type": "PERCENTAGE", 
//   "value": 10,
//   "applicableTo": "SPECIFIC",
//   "targetType": "SERVICE",
//   "targetIds": [1],
//   "conditions": {
//     "maxCalls": 1000
//   }
// }

// {
//   "name": "Giảm giá cho thành viên",
//   "type": "FIXED_AMOUNT",
//   "value": 50000,
//   "applicableTo": "ALL",
//   "targetType": "USER",
//   "conditions": {
//     "userRoles": ["member"]
//   }
// }

// {
//   "name": "Giảm giá theo usage",
//   "type": "USAGE_BASED", 
//   "value": 100000,
//   "applicableTo": "SPECIFIC",
//   "targetType": "SERVICE",
//   "targetIds": [1],
//   "conditions": {
//     "usagePercentage": 80,
//     "maxCalls": 1000
//   }
// }