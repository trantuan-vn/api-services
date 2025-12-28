import { z } from 'zod';

// Common Schemas
export const OrderStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED']);
export const DiscountTypeSchema = z.enum(['SERVICE_PRICE', 'USER_PRICE', 'SERVICE_VOUCHER', 'USER_VOUCHER']);

// Main Schemas
export const OrderSchema = z.object({
  orderCode: z.string(),
  subtotalAmount: z.number().min(0),
  discountAmount: z.number().min(0).default(0),
  finalAmount: z.number().min(0),
  status: OrderStatusSchema,
  currency: z.string().default('VND'),
  appliedVoucherCode: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const OrderItemSchema = z.object({
  orderId: z.number().int(),
  serviceId: z.number().int(),
  basePrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0),
  finalAmount: z.number().min(0),
  quantity: z.number().min(1),
});

export const OrderItemDiscountSchema = z.object({
  orderItemId: z.number().int(),
  discountType: DiscountTypeSchema,
  discountAmount: z.number().min(0),
  appliedPolicies: z.array(z.object({
    policyId: z.number().int(),
    policyName: z.string(),
    discount: z.number(),
    type: z.string(),
  })).optional(),  
  appliedVoucherCode: z.string().optional(),
  description: z.string().optional(),
});

// Request Schemas
export const CreateOrderItemSchema = z.object({
  serviceId: z.number().int().min(1, "Service ID is required"),
  basePrice: z.number().min(0, "Base price must be positive"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
});

export const CreateOrderSchema = z.object({
  items: z.array(CreateOrderItemSchema).min(1, "At least one item is required"),
  currency: z.string().default('VND'),
  voucherCode: z.string().optional(),
  notes: z.string().optional(),
  paymentMethod: z.string().optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: OrderStatusSchema,
  notes: z.string().optional(),
});

export const ApplyVoucherToOrderSchema = z.object({
  voucherCode: z.string().min(1, "Voucher code is required"),
});

export const CalculateOrderRequestSchema = z.object({
  items: z.array(CreateOrderItemSchema).min(1, "At least one item is required"),
  voucherCode: z.string().optional(),
  currency: z.string().default('VND'),
});

// Calculation Result Schemas (mới thêm)
export const PriceCalculationResultSchema = z.object({
  finalPrice: z.number().min(0),
  totalDiscount: z.number().min(0),
  appliedPolicies: z.array(z.object({
    policyId: z.number().int(),
    policyName: z.string(),
    discount: z.number(),
    type: z.string(),
  })).default([]),
});

export const VoucherCalculationResultSchema = z.object({
  finalAmount: z.number().min(0),
  discountAmount: z.number().min(0),
  voucher: z.any().optional(),
});

export const DiscountDetailSchema = z.object({
  servicePriceDiscount: z.object({
    amount: z.number().min(0),
    type: z.literal('service_price'),
    appliedPolicies: z.array(z.object({
      policyId: z.number().int(),
      policyName: z.string(),
      discount: z.number(),
      type: z.string(),
    })),
  }).optional(),
  userPriceDiscount: z.object({
    amount: z.number().min(0),
    type: z.literal('user_price'),
    appliedPolicies: z.array(z.object({
      policyId: z.number().int(),
      policyName: z.string(),
      discount: z.number(),
      type: z.string(),
    })),
  }).optional(),
  serviceVoucherDiscount: z.object({
    amount: z.number().min(0),
    type: z.literal('service_voucher'),
    voucher: z.any(),
  }).optional(),
  userVoucherDiscount: z.object({
    amount: z.number().min(0),
    type: z.literal('user_voucher'),
    voucher: z.any(),
  }).optional(),
});

export const OrderCalculationItemSchema = z.object({
  serviceId: z.number().int(),
  basePrice: z.number().min(0),
  quantity: z.number().min(1),
  servicePrice: PriceCalculationResultSchema,
  userPrice: PriceCalculationResultSchema,
  serviceVoucher: VoucherCalculationResultSchema,
  userVoucher: VoucherCalculationResultSchema,
  discounts: DiscountDetailSchema.optional(),
});

export const OrderCalculationResultSchema = z.object({
  items: z.array(OrderCalculationItemSchema),
});



// Types
export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderItemDiscount = z.infer<typeof OrderItemDiscountSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

export type CreateOrder = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatus = z.infer<typeof UpdateOrderStatusSchema>;
export type ApplyVoucherToOrder = z.infer<typeof ApplyVoucherToOrderSchema>;
export type CalculateOrderRequest = z.infer<typeof CalculateOrderRequestSchema>;

export type PriceCalculationResult = z.infer<typeof PriceCalculationResultSchema>;
export type VoucherCalculationResult = z.infer<typeof VoucherCalculationResultSchema>;
export type DiscountDetail = z.infer<typeof DiscountDetailSchema>;
export type OrderCalculationItem = z.infer<typeof OrderCalculationItemSchema>;
export type OrderCalculationResult = z.infer<typeof OrderCalculationResultSchema>;

export interface OrderResponse {
  success: boolean;
  data: {
    id: string;
    orderCode: string;
    items: Array<{
      serviceId: string;
      quantity: number;
      basePrice: number;
      discounts: Array<any>;
    }>;
    summary: {
      subtotalAmount: number;
      discountAmount: number;
      finalAmount: number;
      currency: string;
    };
  };
  message: string;
}
export interface OrderDetail extends Order {
  items: OrderItem[];
  discounts: OrderItemDiscount[];
}

// Filter Types
export interface OrderFilters {
  status?: OrderStatus;
  targetType?: 'SERVICE' | 'USER';
  page?: number;
  limit?: number;
}

// Domain Interfaces
export interface IOrderInfrastructureService {
  createOrder(user: any, request: CreateOrder): Promise<{ id: string; items: OrderCalculationItem[] }>;
  getOrders(filters: OrderFilters): Promise<OrderDetail[]>;
  getOrderDetail(orderId: string): Promise<OrderDetail>;
  updateOrderStatus(orderId: string, request: UpdateOrderStatus): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
}

// Service Interfaces cho external services
export interface IPriceApplicationService {
  calculateServicePrice(identifier: string, request: any): Promise<PriceCalculationResult>;
  calculateUserPrice(identifier: string, request: any): Promise<PriceCalculationResult>;
}

export interface IVoucherApplicationService {
  applyServiceVoucher(identifier: string, request: any): Promise<VoucherCalculationResult>;
  applyUserVoucher(identifier: string, request: any): Promise<VoucherCalculationResult>;
}

// Error Types
export const OrderErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

export type OrderError = z.infer<typeof OrderErrorSchema>;

// Constants
export const ORDER_DEFAULT_LIMIT = 20;
export const ORDER_DEFAULT_PAGE = 1;
export const ORDER_CURRENCY = 'VND';

// Helper Functions
export const validateOrderAmounts = (order: Order): boolean => {
  return order.finalAmount === order.subtotalAmount - order.discountAmount;
};

export const canCancelOrder = (status: OrderStatus): boolean => {
  return !['COMPLETED', 'CANCELLED'].includes(status);
};

// VÍ DỤ SỬ DỤNG:

// 1. Tạo order cho Service (customer mua service)
// POST /api/v1/orders/orders
// {
//   "targetType": "SERVICE",
//   "customerId": "comp_techcorp",
//   "customerName": "Công ty TechCorp",
//   "userId": "user_admin01",
//   "items": [
//     {
//       "serviceId": "api_premium",
//       "serviceName": "API Premium Plan", 
//       "basePrice": 5000000,
//       "quantity": 1,
//       "currentCalls": 1500,
//       "maxCalls": 10000
//     }
//   ],
//   "voucherCode": "APISALE20",
//   "notes": "Nâng cấp gói API"
// }

// 2. Tạo order cho User (user cá nhân mua service)
// {
//   "targetType": "USER", 
//   "userId": "user_john_doe",
//   "userRole": "member",
//   "customerId": "comp_abc", // optional: user có thể thuộc customer
//   "customerName": "Công ty ABC",
//   "items": [
//     {
//       "serviceId": "basic_plan",
//       "serviceName": "Basic Plan",
//       "basePrice": 300000,
//       "quantity": 1,
//       "currentCalls": 100,
//       "maxCalls": 1000
//     }
//   ],
//   "voucherCode": "WELCOME10",
//   "notes": "Đăng ký gói basic"
// }

// 3. Tính toán giá order
// POST /api/v1/orders/calculate
// {
//   "targetType": "SERVICE",
//   "customerId": "comp_techcorp",
//   "userId": "user_admin01",
//   "items": [
//     {
//       "serviceId": "api_premium",
//       "serviceName": "API Premium Plan",
//       "basePrice": 5000000,
//       "quantity": 1,
//       "currentCalls": 1500,
//       "maxCalls": 10000
//     }
//   ],
//   "voucherCode": "APISALE20"
// }