import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { 
  ShardConfig, ShardConfigName, ShardInfo, UserRegistration, UserBatch, 
  ShardPerformance, CleanupOperation, ShardConfigResponse, UserCountResponse,
  DEFAULT_SHARD_CONFIGS, ShardValidator, UserRegistrationSchema,
  CleanupOperationSchema, ShardPerformanceSchema, ShardConfigSchema
} from '../domain';
import { handleErrorWithoutIp } from '../../../shared/utils';

export class UserShardDO extends DurableObject {

  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;

  private shardConfig: ShardConfig = DEFAULT_SHARD_CONFIGS['1M+'];
  private shardConfigName: ShardConfigName = '1M+';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.database = new UserDODatabase(this.storage, this.userId);
    this.state.blockConcurrencyWhile(async () => {
      this.table('user_registrations', UserRegistrationSchema);
      this.table('cleanup_operations', CleanupOperationSchema);
      this.table('shard_performances', ShardPerformanceSchema);
      this.table('shard_configs', ShardConfigSchema);
      await this.initialize();
    });
  }

  // =============================================
  // GETTERS & INITIALIZATION
  // =============================================
  get userId(): string { return this.state.id.toString(); }
  get shardName(): string { return this.state.id.name!; }

  table<T extends z.ZodSchema>(name: string, schema: T, options?: TableOptions) {
    return this.database.table(name, schema, options);
  }

  private async initialize() {
    
    const existingConfig = await this.database.getTable("shard_configs")?.where('key', '==', 'scaleConfigName').first();
    if (!existingConfig) {
      await Promise.all([
        this.database.dynamicInsert('shard_configs', DEFAULT_SHARD_CONFIGS['1M+']),
        this.database.dynamicInsert('shard_performances', this.getInitialPerformanceMetrics()),
      ]);
    }
    this.shardConfig = existingConfig ?? DEFAULT_SHARD_CONFIGS['1M+'];
  }

  // =============================================
  // REQUEST HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'shard.internal') return await this.handleInternalMessage(request);

      const routes: Record<string, () => Promise<Response> | Response> = {
        '/info': () => this.getShardInfo(),
        '/users': () => request.method === 'GET' ? this.getUsersList() : new Response('Method not allowed', { status: 405 }),
        '/count': () => this.getUserCountResponse(),
        '/config': () => request.method === 'POST' ? this.handleUpdateConfig(request) : new Response('Method not allowed', { status: 405 }),
        '/cleanup': () => request.method === 'POST' ? this.handleCleanup(request) : new Response('Method not allowed', { status: 405 }),
        '/performance': () => this.getPerformanceMetrics()
      };

      return routes[url.pathname]?.() || new Response('Not found', { status: 404 });
    } catch (error) {
      handleErrorWithoutIp(error, `UserShardDO ${this.userId} fetch error`);
      return new Response("Internal Server Error", { status: 500 });
    }        
  }

  // =============================================
  // INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/repository/')) {
      return await this.handleRepositoryOperations(request, url.pathname);
    }

    const body = await request.json() as { action: string; [key: string]: any };
    const { action, ...data } = body;
    
    const actions: Record<string, Function> = {
      broadcast: () => this.handleFastBroadcast(data),
      user_delivery_report: () => this.handleUserDeliveryReport(data),
      registerUser: () => this.registerUser(data.userId),
      unregisterUser: () => this.unregisterUser(data.userId)
    };

    if (actions[action]) await actions[action]();
    return new Response(JSON.stringify({ status: 'processed' }));
  }

  private async handleRepositoryOperations(request: Request, path: string): Promise<Response> {
    const data = await request.json() as any;
    
    const operations: Record<string, Function> = {
      '/repository/transaction': () => this.database.execTransaction(data.operations),
      '/repository/select': async () => {
        const result = await this.database.execSelectSQL(data.sql, data.params || []);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      },
    };

    if (operations[path]) {
      const result = await operations[path]();
      return result instanceof Response ? result : new Response(JSON.stringify(result));
    }
    
    return new Response('Not found', { status: 404 });
  }

  // =============================================
  // BROADCAST MANAGEMENT
  // =============================================
  private async handleFastBroadcast(data: any) {
    const { broadcastId, message, targetUsers } = data;
    this.ctx.waitUntil(this.processFastBroadcast(broadcastId, message, targetUsers));
    return { status: 'accepted' };
  }

  private async processFastBroadcast(broadcastId: number, message: any, targetUsers?: string[]) {
    const users = targetUsers 
      ? await this.getSpecificUsers(targetUsers)
      : await this.getActiveUsers();

    if (users.length === 0) return;

    const batches = this.createOptimizedBatches(users, broadcastId);
    await this.sendBatchesWithMessage(batches, broadcastId, message);
    this.ctx.waitUntil(this.reportEstimatedDelivery(broadcastId, users.length));
  }

  private async getSpecificUsers(userIds: string[]): Promise<string[]> {
    const validUsers: string[] = [];
    for (const userId of userIds) {
      const user = await this.database.getTable("user_registrations")?.where('userId', '==', userId).first();
      if (user?.isActive) validUsers.push(userId);
    }
    return validUsers;
  }

  private async getActiveUsers(): Promise<string[]> {
    const users = await this.database.getTable("user_registrations")?.where('isActive', '==', true).get();
    return users ? users.map((user: any) => user.userId) : [];
  }

  private createOptimizedBatches(userIds: string[], broadcastId: number): UserBatch[] {
    const chunks = this.chunkArray(userIds, this.shardConfig.BATCH_SIZE);
    return chunks.map((userIdsChunk, index) => ({
      batchId: `${broadcastId}_batch_${index}`,
      userIds: userIdsChunk,
      shardName: this.shardName,
      createdAt: Date.now(),
      broadcastId,
      size: userIdsChunk.length,
      processingOrder: index,
      priority: 'normal',
    }));
  }

  private async sendBatchesWithMessage(batches: UserBatch[], broadcastId: number, message: any) {
    const sendPromises = batches.map(batch => 
      this.sendBatchToUsersWithMessage(batch, broadcastId, message)
    );
    this.ctx.waitUntil(Promise.allSettled(sendPromises));
  }

  private async sendBatchToUsersWithMessage(batch: UserBatch, broadcastId: number, message: any) {
    const userPromises = batch.userIds.map(userId =>
      this.sendToUserDirect(userId, { type: 'broadcast', broadcastId, message, timestamp: Date.now() })
    );

    const results = await Promise.allSettled(userPromises);
    const successfulSends = results.filter(r => r.status === 'fulfilled').length;
    await this.updateLocalMetrics(broadcastId, successfulSends);
  }

  private async sendToUserDirect(userId: string, message: any) {
    const userDO = this.env.USER_DO.get(this.env.USER_DO.idFromName(userId));
    const response = await userDO.fetch('https://user.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (!response.ok) throw new Error(`Failed to send message to user ${userId}: ${response.statusText}`);
    return { success: true, userId };
  }

  private async updateLocalMetrics(broadcastId: number, deliveredCount: number) {
    const current = await this.storage.get<number>(`delivery_${broadcastId}`) || 0;
    await this.storage.put(`delivery_${broadcastId}`, current + deliveredCount);
  }

  private async reportEstimatedDelivery(broadcastId: number, estimatedTotal: number) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const deliveredCount = await this.storage.get<number>(`delivery_${broadcastId}`) || 0;
    
    if (deliveredCount > 0) {
      const broadcastService = this.env.BROADCAST_SERVICE_DO.get(this.env.BROADCAST_SERVICE_DO.idFromName("global"));
      await broadcastService.fetch('https://broadcast.internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delivery_report', broadcastId, deliveredCount, shardName: this.shardName, timestamp: Date.now() })
      });
      await this.storage.delete(`delivery_${broadcastId}`);
    }
  }

  private async handleUserDeliveryReport(data: any) {
    const { broadcastId, deliveredCount } = data;
    if (broadcastId && deliveredCount) await this.updateLocalMetrics(broadcastId, deliveredCount);
  }

  // =============================================
  // USER MANAGEMENT
  // =============================================
  async registerUser(userId: string) {    
    const existingUser = await this.database.getTable("user_registrations")?.where('userId', '==', userId).first();
    if (existingUser) {
      await this.database.dynamicUpdate('user_registrations', existingUser.id, { isActive: true });      
    } else {
      const [userCount, activeCount] = await Promise.all([this.getUserCount(), this.getActiveUserCount()]);
      await this.database.dynamicMultiTableTransaction([
        {
          table: 'user_registrations',
          operation: 'insert',
          data: { userId, shardName: this.shardName, tags: [], priority: 'normal', isActive: true }
        },
        {
          table: 'shard_performances', 
          operation: 'upsert',
          data: {
            shardName: this.shardName,
            totalUsers: userCount + 1,
            activeUsers: activeCount + 1,
            userGrowthRate: await this.calculateGrowthRate(),
            timestamp: Date.now()
          }
        }
      ]);                  
    }
  }

  async unregisterUser(userId: string) {
    const existingUser = await this.database.getTable("user_registrations")?.where('userId', '==', userId).first();
    if (!existingUser) throw new Error('User not found');

    const [userCount, activeCount] = await Promise.all([this.getUserCount(), this.getActiveUserCount()]);
    await this.database.dynamicMultiTableTransaction([
      {
        table: 'user_registrations',
        operation: 'delete',
        id: existingUser.id
      },
      {
        table: 'shard_performances',
        operation: 'upsert', 
        data: {
          shardName: this.shardName,
          totalUsers: Math.max(0, userCount - 1),
          activeUsers: Math.max(0, activeCount - 1),
          userGrowthRate: await this.calculateGrowthRate(),
          timestamp: Date.now()
        }
      }
    ]);
  }

  // =============================================
  // SHARD MANAGEMENT & INFO
  // =============================================
  async getShardInfo(): Promise<Response> {
    const [userCount, performance] = await Promise.all([this.getUserCount(), this.getPerformanceMetricsData()]);
    const shardInfo: ShardInfo = {
      shardName: this.shardName,
      userCount,
      config: this.shardConfig,
      timestamp: Date.now(),
      processingLoad: performance.activeUsers / (performance.totalUsers || 1),
      averageBatchTime: performance.averageProcessingTime,
      lastActivity: performance.timestamp,
      healthStatus: this.calculateHealthStatus(performance),
      errorRate: performance.errorRate || 0
    };
    return new Response(JSON.stringify(shardInfo), { headers: { 'Content-Type': 'application/json' } });
  }

  async getUsersList(): Promise<Response> {
    const users = await this.database.getTable("user_registrations")?.getAll();
    const userList = users ? users.map((user: any) => user.userId) : [];
    return new Response(JSON.stringify({ users: userList, count: userList.length, shardName: this.shardName }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getUserCountResponse(): Promise<Response> {
    const [userCount, performance] = await Promise.all([this.getUserCount(), this.getPerformanceMetricsData()]);
    const response: UserCountResponse = { shardName: this.shardName, userCount, activeUsers: performance.activeUsers, timestamp: Date.now() };
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }

  private async getUserCount(): Promise<number> {
    const users = await this.database.getTable("user_registrations")?.getAll();
    return users ? users.length : 0;
  }

  private async getActiveUserCount(): Promise<number> {
    const activeUsers = await this.database.dynamicSelect('user_registrations', { field: 'isActive', operator: '=', value: true });
    return activeUsers.length;      
  }

  private async calculateGrowthRate(): Promise<number> {
    
    const metrics = await this.database.getTable("shard_performances")?.where('shardName', '==', this.shardName).first();
    if (!metrics) return 0;
    
    const previousTotalUsers = metrics.totalUsers || 0;
    const currentTotalUsers = await this.getUserCount();
    if (previousTotalUsers === 0) return currentTotalUsers > 0 ? 1.0 : 0;

    const growthRate = (currentTotalUsers - previousTotalUsers) / previousTotalUsers;
    return Math.round(growthRate * 100) / 100;
  }

  // =============================================
  // CONFIGURATION & PERFORMANCE
  // =============================================
  private async handleUpdateConfig(request: Request): Promise<Response> {
    const { scale } = await request.json() as { scale: string };
    if (!scale || !DEFAULT_SHARD_CONFIGS[scale as ShardConfigName]) throw new Error('Invalid scale');

    const previousConfig = this.shardConfigName;
    await this.updateShardConfig(scale as ShardConfigName);
    
    const response: ShardConfigResponse = {
      scale: scale as ShardConfigName,
      config: this.shardConfig,
      shardName: this.shardName,
      previousConfig,
      estimatedCapacity: this.getEstimatedCapacity()
    };
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }

  async updateShardConfig(scale: ShardConfigName) {
    this.shardConfigName = scale;
    this.shardConfig = DEFAULT_SHARD_CONFIGS[scale];
    
    const existingConfig = await this.database.getTable("shard_configs")?.where('key', '==', 'shardConfig').first();
    if (existingConfig) {
      await this.database.dynamicUpdate('shard_configs',  existingConfig.id, DEFAULT_SHARD_CONFIGS[scale]);
    } else {
      await this.database.dynamicInsert('shard_configs', DEFAULT_SHARD_CONFIGS[scale]);
    }
  }

  private getInitialPerformanceMetrics(): ShardPerformance {
    return {
      shardName: this.shardName,
      timestamp: Date.now(),
      totalUsers: 0, activeUsers: 0, userGrowthRate: 0,
      batchesProcessed: 0, averageBatchSize: 0, averageProcessingTime: 0,
      usersPerSecond: 0, peakThroughput: 0, errorRate: 0, retryRate: 0
    };
  }

  async getPerformanceMetrics(): Promise<Response> {
    const metrics = await this.getPerformanceMetricsData();
    return new Response(JSON.stringify(metrics), { headers: { 'Content-Type': 'application/json' } });
  }

  private async getPerformanceMetricsData(): Promise<ShardPerformance> {
    const metrics = await this.database.getTable("shard_performances")?.where('shardName', '==', this.shardName).first();
    return metrics || this.getInitialPerformanceMetrics();
  }

  // =============================================
  // CLEANUP AND UTILITIES
  // =============================================
  private async handleCleanup(request: Request): Promise<Response> {
    const { inactiveUserIds, cleanupThreshold } = await request.json() as { inactiveUserIds: string[], cleanupThreshold?: number };
    if (!Array.isArray(inactiveUserIds)) throw new Error('Invalid inactive user IDs');

    const validUserIds = inactiveUserIds.filter(id => ShardValidator.isValidUserId(id));
    const operation = await this.cleanupInactiveUsers(validUserIds, cleanupThreshold);
    return new Response(JSON.stringify(operation), { headers: { 'Content-Type': 'application/json' } });
  }

  async cleanupInactiveUsers(inactiveUserIds: string[], cleanupThreshold?: number): Promise<CleanupOperation> {
    if (inactiveUserIds.length === 0) return ShardValidator.validateCleanupOperation([], this.shardName);

    const operation = ShardValidator.validateCleanupOperation(inactiveUserIds, this.shardName);
    if (cleanupThreshold) operation.cleanupThreshold = cleanupThreshold;

    try {
      let removedCount = 0;
      for (const userId of inactiveUserIds) {
        
        const userRecord = await this.database.getTable("user_registrations")?.where('userId', '==', userId).first();
        if (userRecord) {
          await this.database.dynamicDelete('user_registrations', userRecord.id);
          removedCount++;
        }
      }

      operation.usersRemoved = removedCount;
      operation.usersSkipped = inactiveUserIds.length - removedCount;
      operation.status = 'completed';
      operation.processingTime = Date.now() - operation.timestamp;
      await this.database.dynamicInsert('cleanup_operations', operation);
      return operation;
      
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error);
      await this.database.dynamicInsert('cleanup_operations', operation);
      return operation;
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private calculateHealthStatus(performance: ShardPerformance): 'healthy' | 'degraded' | 'unhealthy' {
    if (performance.errorRate > 0.1) return 'unhealthy';
    if (performance.errorRate > 0.05) return 'degraded';
    return 'healthy';
  }

  private getEstimatedCapacity(): string {
    const hourlyCapacity = this.shardConfig.BATCH_SIZE * (60000 / this.shardConfig.DELAY_BETWEEN_BATCHES) * 60;
    if (hourlyCapacity >= 1000000) return `${Math.round(hourlyCapacity / 1000000)}M+/hour`;
    if (hourlyCapacity >= 1000) return `${Math.round(hourlyCapacity / 1000)}K+/hour`;
    return `${hourlyCapacity}+/hour`;
  }
}