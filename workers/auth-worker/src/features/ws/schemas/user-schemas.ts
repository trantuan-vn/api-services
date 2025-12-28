import { z } from 'zod';

// User Domain Object Schemas
export const ConnectionSchema = z.object({
  connected: z.boolean(),
  lastConnected: z.number(),
  sessionId: z.string().uuid(),
});

export const PendingMessageSchema = z.object({
  message: z.any(),
  type: z.string(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  attempts: z.number().min(0).default(0),
  maxAttempts: z.number().min(1).default(3),
  lastAttempt: z.number().optional(),
  scheduledFor: z.number().optional(),
  sessionId: z.string().uuid(),
});

export const SubscriptionSchema = z.object({
  channel: z.string(),
  subscribedAt: z.number(),
  filters: z.record(z.any()).optional(),
  isActive: z.boolean().default(true)
});

export const AlarmSchema = z.object({
  type: z.enum(['heartbeat', 'broadcast', 'retry', 'custom']),
  scheduledTime: z.number(),
  data: z.any().optional(),
  status: z.enum(['pending', 'executing', 'completed', 'failed']).default('pending'),
});

export const UserPreferenceSchema = z.object({
  key: z.string(),
  value: z.any(),
  category: z.string().default('general'),
});

// Export types
export type Connection = z.infer<typeof ConnectionSchema>;
export type PendingMessage = z.infer<typeof PendingMessageSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Alarm = z.infer<typeof AlarmSchema>;
export type UserPreference = z.infer<typeof UserPreferenceSchema>;