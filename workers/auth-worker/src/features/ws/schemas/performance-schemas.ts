import { z } from 'zod';

// Performance Monitoring
export const ShardPerformanceSchema = z.object({
  shardName: z.string(),
  timestamp: z.number().int().positive(),
  totalUsers: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative(),
  userGrowthRate: z.number().default(0),
  batchesProcessed: z.number().int().nonnegative(),
  averageBatchSize: z.number().nonnegative(),
  averageProcessingTime: z.number().nonnegative(),
  usersPerSecond: z.number().nonnegative(),
  peakThroughput: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1).default(0),
  retryRate: z.number().min(0).max(1).default(0),
  storageUsage: z.number().nonnegative().optional(),
  memoryUsage: z.number().nonnegative().optional()
});

export const BatchMetricsSchema = z.object({
  batchId: z.string(),
  shardName: z.string(),
  broadcastId: z.number().int(),
  totalUsers: z.number().int().nonnegative(),
  processedUsers: z.number().int().nonnegative(),
  failedUsers: z.number().int().nonnegative(),
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
  usersPerSecond: z.number().nonnegative().optional(),
  averageDelay: z.number().nonnegative().optional(),
  status: z.enum(['in_progress', 'completed', 'partial_failure', 'failed']),
  completionPercentage: z.number().min(0).max(100)
});

// Cleanup and Maintenance
export const CleanupOperationSchema = z.object({
  shardName: z.string(),
  timestamp: z.number().int().positive(),
  inactiveUserIds: z.array(z.string()),
  cleanupThreshold: z.number().int().positive().default(30 * 24 * 60 * 60 * 1000),
  usersRemoved: z.number().int().nonnegative().default(0),
  usersSkipped: z.number().int().nonnegative().default(0),
  storageFreed: z.number().nonnegative().optional(),
  processingTime: z.number().nonnegative().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  error: z.string().optional()
});

export const UserInactivitySchema = z.object({
  userId: z.string(),
  shardName: z.string(),
  lastSeen: z.number().int().positive(),
  daysInactive: z.number().int().nonnegative(),
  isEligibleForCleanup: z.boolean(),
  totalSessions: z.number().int().nonnegative().optional(),
  averageSessionLength: z.number().nonnegative().optional(),
  lastBroadcastReceived: z.number().int().positive().optional()
});

// Error Handling
export const ShardErrorSchema = z.object({
  errorId: z.number().int(),
  shardName: z.string(),
  timestamp: z.number().int().positive(),
  type: z.enum([
    'storage_error',
    'processing_error', 
    'batch_error',
    'user_error',
    'configuration_error',
    'unknown_error'
  ]),
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  operation: z.string(),
  userId: z.string().optional(),
  broadcastId: z.number().int().optional(),
  batchIndex: z.number().int().optional(),
  autoRetry: z.boolean().default(false),
  retryCount: z.number().int().nonnegative().default(0),
  resolved: z.boolean().default(false)
});

// Request/Response
export const ShardConfigResponseSchema = z.object({
  scale: z.enum(['10K', '100K', '1M+']),
  config: z.object({
    BATCH_SIZE: z.number().int().positive(),
    PARALLEL_BATCHES: z.number().int().positive(),
    DELAY_BETWEEN_BATCHES: z.number().int().nonnegative(),
    STAGGER_WINDOW: z.number().int().nonnegative()
  }),
  shardName: z.string(),
  previousConfig: z.enum(['10K', '100K', '1M+']).optional(),
  estimatedCapacity: z.string().optional()
});

export const UserCountResponseSchema = z.object({
  shardName: z.string(),
  userCount: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().positive()
});

export const BatchProcessingResponseSchema = z.object({
  shardName: z.string(),
  broadcastId: z.number().int(),
  totalBatches: z.number().int().positive(),
  totalUsers: z.number().int().nonnegative(),
  estimatedCompletionTime: z.number().int().positive().optional(),
  batchProgress: z.array(z.object({
    batchIndex: z.number().int().nonnegative(),
    status: z.string(),
    userCount: z.number().int().nonnegative()
  }))
});

// Export types
export type ShardPerformance = z.infer<typeof ShardPerformanceSchema>;
export type BatchMetrics = z.infer<typeof BatchMetricsSchema>;
export type CleanupOperation = z.infer<typeof CleanupOperationSchema>;
export type UserInactivity = z.infer<typeof UserInactivitySchema>;
export type ShardError = z.infer<typeof ShardErrorSchema>;
export type ShardConfigResponse = z.infer<typeof ShardConfigResponseSchema>;
export type UserCountResponse = z.infer<typeof UserCountResponseSchema>;
export type BatchProcessingResponse = z.infer<typeof BatchProcessingResponseSchema>;