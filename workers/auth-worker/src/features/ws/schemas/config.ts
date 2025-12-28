import { ScaleConfig, ScaleConfigName } from './broadcast-schemas';
import { ServiceConfig } from './service-schemas';
import { ShardConfig, ShardConfigName, ShardStorage } from './shard-schemas';

export const DEFAULT_SCALE_CONFIGS: Record<ScaleConfigName, ScaleConfig> = {
  '10K': {
    SHARD_COUNT: 100,
    PARALLEL_SHARD_PROCESSING: 10,
    BATCH_DELAY_MS: 50
  },
  '100K': {
    SHARD_COUNT: 500,
    PARALLEL_SHARD_PROCESSING: 25,
    BATCH_DELAY_MS: 30
  },
  '1M+': {
    SHARD_COUNT: 1000,
    PARALLEL_SHARD_PROCESSING: 50,
    BATCH_DELAY_MS: 10
  }
};

export const DEFAULT_SHARD_CONFIGS: Record<ShardConfigName, ShardConfig> = {
  '10K': {
    BATCH_SIZE: 500,
    PARALLEL_BATCHES: 5,
    DELAY_BETWEEN_BATCHES: 1000,
    STAGGER_WINDOW: 30000
  },
  '100K': {
    BATCH_SIZE: 1000,
    PARALLEL_BATCHES: 10,
    DELAY_BETWEEN_BATCHES: 500,
    STAGGER_WINDOW: 60000
  },
  '1M+': {
    BATCH_SIZE: 2000,
    PARALLEL_BATCHES: 15,
    DELAY_BETWEEN_BATCHES: 200,
    STAGGER_WINDOW: 120000
  }
};

export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  scaleConfig: '1M+',
  autoScaling: false,
  maxShards: 1000,
  defaultBatchSize: 25,
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  deliveryRecordTTL: 7 * 24 * 60 * 60 * 1000,
  analyticsRetentionDays: 30,
  enableDetailedAnalytics: true,
  enableDeliveryTracking: true,
  enableShardHealthChecks: false
};

export const DEFAULT_SHARD_STORAGE: ShardStorage = {
  users: [],
  userCount: 0,
  shardConfig: '1M+',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: '1.0.0'
};