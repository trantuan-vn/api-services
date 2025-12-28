
import { z } from 'zod';
import { 
  BroadcastData, 
  BroadcastDataSchema, 
  CreateBroadcast, 
  CreateBroadcastSchema,
  ScaleConfig,
  ScaleConfigSchema,
  DeliveryRecord,
  DeliveryRecordSchema 
} from './broadcast-schemas';
import { 
  ShardConfig, 
  ShardConfigSchema, 
  BroadcastTrigger, 
  BroadcastTriggerSchema,
  UserRegistration,
  UserRegistrationSchema,
  UserBatch,
  UserBatchSchema,
  UserAlarm,
  UserAlarmSchema 
} from './shard-schemas';
import { CleanupOperation, CleanupOperationSchema } from './performance-schemas';

export class BroadcastValidator {
  static validateBroadcastData(data: unknown): BroadcastData {
    return BroadcastDataSchema.parse(data);
  }

  static validateCreateBroadcast(input: unknown): CreateBroadcast {
    return CreateBroadcastSchema.parse(input);
  }

  static validateScaleConfig(config: unknown): ScaleConfig {
    return ScaleConfigSchema.parse(config);
  }

  static validateDeliveryRecord(record: unknown): DeliveryRecord {
    return DeliveryRecordSchema.parse(record);
  }

  static sanitizeBroadcastMessage(message: any): any {
    const { toJSON, ...safeMessage } = message;
    return safeMessage;
  }

  static validateUserId(userId: string): boolean {
    return z.string().min(1).max(256).safeParse(userId).success;
  }

  static validateBroadcastId(broadcastId: number): boolean {
    return z.number().min(1).max(256).safeParse(broadcastId).success;
  }
}

export class ShardValidator {
  static validateShardConfig(config: unknown): ShardConfig {
    return ShardConfigSchema.parse(config);
  }

  static validateBroadcastTrigger(input: unknown): BroadcastTrigger {
    return BroadcastTriggerSchema.parse(input);
  }

  static validateUserRegistration(userId: string, shardName: string): UserRegistration {
    return UserRegistrationSchema.parse({
      userId,
      shardName,
    });
  }

  static validateUserBatch(userIds: string[], shardName: string): UserBatch {
    return UserBatchSchema.parse({
      userIds,
      shardName,
      size: userIds.length
    });
  }

  static validateUserAlarm(
    userId: string, 
    broadcastId: string, 
    baseDelay: number, 
    staggerDelay: number
  ): UserAlarm {
    return UserAlarmSchema.parse({
      userId,
      broadcastId,
      alarmTime: Date.now() + baseDelay + staggerDelay,
      baseDelay,
      staggerDelay,
      totalDelay: baseDelay + staggerDelay
    });
  }

  static validateCleanupOperation(inactiveUserIds: string[], shardName: string): CleanupOperation {
    return CleanupOperationSchema.parse({
      shardName,
      timestamp: Date.now(),
      inactiveUserIds,
      status: 'pending'
    });
  }

  static isValidUserId(userId: string): boolean {
    return z.string().safeParse(userId).success;
  }

  static isValidShardName(shardName: string): boolean {
    return /^shard-\d+$/.test(shardName);
  }

  static isValidBroadcastId(broadcastId: string): boolean {
    return z.string().safeParse(broadcastId).success;
  }

  static validateBatchSize(batchSize: number, config: ShardConfig): boolean {
    return batchSize > 0 && batchSize <= config.BATCH_SIZE * 2;
  }
}