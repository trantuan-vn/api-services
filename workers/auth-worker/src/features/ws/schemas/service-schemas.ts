import { z } from 'zod';
import { ScaleConfigNameSchema, ScaleConfigSchema } from './broadcast-schemas';

// Service Configuration
export const ServiceConfigSchema = z.object({
  scaleConfig: ScaleConfigNameSchema,
  autoScaling: z.boolean().default(false),
  maxShards: z.number().int().positive().default(1000),
  defaultBatchSize: z.number().int().positive().default(25),
  maxRetryAttempts: z.number().int().positive().default(3),
  retryDelayMs: z.number().int().positive().default(1000),
  deliveryRecordTTL: z.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
  analyticsRetentionDays: z.number().int().positive().default(30),
  enableDetailedAnalytics: z.boolean().default(true),
  enableDeliveryTracking: z.boolean().default(true),
  enableShardHealthChecks: z.boolean().default(false)
});

// Health Monitoring
export const HealthCheckSchema = z.object({
  service: z.literal('BroadcastServiceDO'),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.number().int().positive(),
  storage: z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    latency: z.number().nonnegative().optional()
  }),
  shards: z.object({
    total: z.number().int().nonnegative(),
    healthy: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    unhealthy: z.number().int().nonnegative()
  }),
  activeBroadcasts: z.number().int().nonnegative(),
  deliveryRate: z.number().nonnegative(),
  memoryUsage: z.number().nonnegative().optional(),
  lastBroadcastProcessed: z.number().int().positive().optional(),
  lastDeliveryRecorded: z.number().int().positive().optional()
});

export const ShardHealthSchema = z.object({
  shardName: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  lastCheck: z.number().int().positive(),
  userCount: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  responseTime: z.number().nonnegative().optional(),
  errorRate: z.number().min(0).max(1).default(0),
  lastBroadcast: z.number().int().positive().optional(),
  lastUserActivity: z.number().int().positive().optional()
});

// Request/Response Schemas
export const BroadcastResponseSchema = z.object({
  broadcastId: z.number().int(),
  status: z.string(),
  config: ScaleConfigSchema,
  estimatedUsers: z.number().int().nonnegative().optional(),
  queuePosition: z.number().int().nonnegative().optional()
});

export const ScaleConfigResponseSchema = z.object({
  scale: ScaleConfigNameSchema,
  config: ScaleConfigSchema,
  previousScale: ScaleConfigNameSchema.optional(),
  estimatedCapacity: z.string().optional()
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.any().optional(),
  timestamp: z.number().int().positive()
});

// Export types
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type ShardHealth = z.infer<typeof ShardHealthSchema>;
export type BroadcastResponse = z.infer<typeof BroadcastResponseSchema>;
export type ScaleConfigResponse = z.infer<typeof ScaleConfigResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;