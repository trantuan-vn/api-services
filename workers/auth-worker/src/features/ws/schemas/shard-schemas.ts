import { z } from 'zod';

// Shard Configuration
export const ShardConfigSchema = z.object({
  BATCH_SIZE: z.number().int().positive().min(10).max(10000),
  PARALLEL_BATCHES: z.number().int().positive().min(1).max(50),
  DELAY_BETWEEN_BATCHES: z.number().int().nonnegative().max(5000),
  STAGGER_WINDOW: z.number().int().nonnegative().max(300000)
});

export const ShardConfigNameSchema = z.enum(['10K', '100K', '1M+']);

// Shard Management
export const ShardInfoSchema = z.object({
  shardName: z.string(),
  userCount: z.number().int().nonnegative(),
  config: ShardConfigSchema,
  timestamp: z.number().int().positive(),
  processingLoad: z.number().min(0).max(1).default(0),
  averageBatchTime: z.number().nonnegative().optional(),
  lastActivity: z.number().int().positive().optional(),
  healthStatus: z.enum(['healthy', 'degraded', 'unhealthy']).default('healthy'),
  errorRate: z.number().min(0).max(1).default(0)
});

export const ShardStorageSchema = z.object({
  users: z.array(z.string()),
  userCount: z.number().int().nonnegative(),
  shardConfig: ShardConfigNameSchema,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  version: z.string().default('1.0.0')
});

// User Management
export const UserRegistrationSchema = z.object({
  userId: z.string(),
  shardName: z.string(),
  segment: z.string().optional(),
  tags: z.array(z.string()).default([]),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  isActive: z.boolean().default(true)
});

export const UserBatchSchema = z.object({
  batchId: z.string(),
  userIds: z.array(z.string().min(1).max(256)),
  shardName: z.string(),
  createdAt: z.number().int().positive(),
  size: z.number().int().positive(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  processingOrder: z.number().int().nonnegative().default(0)
});

// Broadcast Processing
export const BroadcastTriggerSchema = z.object({
  broadcastId: z.number().int(),
  targetUsers: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  staggerWindow: z.number().int().nonnegative().optional(),
  batchSize: z.number().int().positive().optional(),
  maxProcessingTime: z.number().int().positive().optional(),
  expiresAt: z.number().int().positive().optional()
});

export const BatchProcessingSchema = z.object({
  batchIndex: z.number().int().nonnegative(),
  totalBatches: z.number().int().positive(),
  userIds: z.array(z.string()),
  broadcastId: z.number().int(),
  scheduledTime: z.number().int().positive(),
  baseDelay: z.number().int().nonnegative(),
  staggerDelay: z.number().int().nonnegative(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).default('pending'),
  processedCount: z.number().int().nonnegative().default(0),
  failedCount: z.number().int().nonnegative().default(0)
});

export const UserAlarmSchema = z.object({
  userId: z.string(),
  broadcastId: z.number().int(),
  alarmTime: z.number().int().positive(),
  baseDelay: z.number().int().nonnegative(),
  staggerDelay: z.number().int().nonnegative(),
  totalDelay: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative().default(3),
  currentAttempt: z.number().int().nonnegative().default(1),
  status: z.enum(['scheduled', 'triggered', 'delivered', 'failed']).default('scheduled'),
  lastAttempt: z.number().int().positive().optional(),
  error: z.string().optional()
});

// Export types
export type ShardConfig = z.infer<typeof ShardConfigSchema>;
export type ShardConfigName = z.infer<typeof ShardConfigNameSchema>;
export type ShardInfo = z.infer<typeof ShardInfoSchema>;
export type ShardStorage = z.infer<typeof ShardStorageSchema>;
export type UserRegistration = z.infer<typeof UserRegistrationSchema>;
export type UserBatch = z.infer<typeof UserBatchSchema>;
export type BroadcastTrigger = z.infer<typeof BroadcastTriggerSchema>;
export type BatchProcessing = z.infer<typeof BatchProcessingSchema>;
export type UserAlarm = z.infer<typeof UserAlarmSchema>;