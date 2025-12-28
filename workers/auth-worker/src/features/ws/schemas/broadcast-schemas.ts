import { z } from 'zod';

// Scale Configuration
export const ScaleConfigSchema = z.object({
  SHARD_COUNT: z.number().int().positive().min(10).max(5000),
  PARALLEL_SHARD_PROCESSING: z.number().int().positive().min(1).max(100),
  BATCH_DELAY_MS: z.number().int().nonnegative().max(10000)
});

export const ScaleConfigNameSchema = z.enum(['10K', '100K', '1M+']);

// Broadcast Core Schemas
export const BroadcastStatusSchema = z.enum([
  'pending',
  'processing', 
  'completed',
  'failed',
  'cancelled'
]);

export const BroadcastDataSchema = z.object({
  message: z.any(),
  timestamp: z.number().int().positive(),
  status: BroadcastStatusSchema,
  delivered: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().default(0),
  targetUsers: z.array(z.string()).nullable().default(null),
  startedAt: z.number().int().positive().optional(),
  completedAt: z.number().int().positive().optional(),
  lastDeliveryTime: z.number().int().positive().optional(),
  error: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  expiresAt: z.number().int().positive().optional()
});

export const CreateBroadcastSchema = z.object({
  message: z.any(),
  targetUsers: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  expiresIn: z.number().int().positive().optional()
});

// Delivery Tracking
export const DeliveryRecordSchema = z.object({
  broadcastId: z.number().int(),
  userId: z.string(),
  deliveredAt: z.number().int().positive(),
  shardName: z.string(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  attempt: z.number().int().positive().default(1),
  success: z.boolean().default(true),
  error: z.string().optional(),
  processingTime: z.number().int().nonnegative().optional(),
  messageSize: z.number().int().positive().optional()
});

// Analytics
export const BroadcastAnalyticsSchema = z.object({
  broadcastId: z.number().int(),
  totalUsers: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative().default(0),
  deliveryRate: z.number().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  startTime: z.number().int().positive(),
  elapsedSeconds: z.number().nonnegative(),
  estimatedCompletionSeconds: z.number().nullable(),
  estimatedCompletionTime: z.string().datetime().nullable(),
  status: z.enum(['completed', 'in_progress', 'stalled', 'failed']),
  shardProgress: z.record(z.string(), z.object({
    delivered: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percentage: z.number().min(0).max(100)
  })).optional(),
  sampleDeliveries: z.array(z.object({
    userId: z.string(),
    deliveredAt: z.string().datetime(),
    shardName: z.string().optional()
  })).max(20),
  averageDeliveryTime: z.number().nonnegative().optional(),
  peakDeliveryRate: z.number().nonnegative().optional()
});

export const DeliveryStatsSchema = z.object({
  broadcastId: z.number().int(),
  totalUsers: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  deliveryRate: z.number().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  startTime: z.number().int().positive(),
  currentTime: z.number().int().positive(),
  sampleDeliveries: z.array(z.object({
    userId: z.string(),
    deliveredAt: z.string().datetime()
  })).max(10)
});

export const UserShardSchema = z.object({
  shardName: z.string(),
  userCount: z.number().default(0),
});

export const GlobalCounterSchema = z.object({
  key: z.string(),
  value: z.any(),
})

// Export types
export type ScaleConfig = z.infer<typeof ScaleConfigSchema>;
export type ScaleConfigName = z.infer<typeof ScaleConfigNameSchema>;
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;
export type BroadcastData = z.infer<typeof BroadcastDataSchema>;
export type CreateBroadcast = z.infer<typeof CreateBroadcastSchema>;
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;
export type BroadcastAnalytics = z.infer<typeof BroadcastAnalyticsSchema>;
export type DeliveryStats = z.infer<typeof DeliveryStatsSchema>;
export type UserShard = z.infer<typeof UserShardSchema>;
export type GlobalCounter = z.infer<typeof GlobalCounterSchema>;