import { z } from 'zod';

export * from './schemas'

// Schema for WebSocket message validation
export const WebSocketMessageSchema = z.object({
  type: z.enum(['ping', 'subscribe', 'unsubscribe']),
  channel: z.string().optional(),
  data: z.any().optional()
});

export * from '../auth/domain';
export * from '../admin/policy/domain';
export * from '../admin/service/domain';
export * from '../admin/voucher/domain';
export * from '../admin/version/domain';
export * from '../member/ekyc/domain';
export * from '../member/order/domain';
export * from '../member/token/domain';
export * from '../member/vnpay/domain';



