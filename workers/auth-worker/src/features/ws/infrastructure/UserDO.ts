import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { getIPAndUserAgent, getSessionIdHash, handleErrorWithoutIp } from '../../../shared/utils.js';

import { 
  ConnectionSchema, PendingMessageSchema, SubscriptionSchema, 
  Subscription, WebSocketMessageSchema,
  DEFAULT_SCALE_CONFIGS, ScaleConfig, UserSchema, SessionSchema,
  PricePolicySchema, ServiceSchema, ServiceUsageSchema, VoucherSchema,
  OrderSchema, OrderItemSchema, OrderItemDiscountSchema, ApiTokenSchema,
  PaymentSchema, RefundSchema, BroadcastValidator, VersionInfoSchema
} from '../domain.js';

const MAX_SEND_FAILURE_COUNT = 3;
const RETRY_ALARM_INTERVAL = 60000;
const QUEUE_FLUSH_INTERVAL = 5000;
const QUEUE_FLUSH_THRESHOLD = 200;

const TableStateSchema = z.object({
  tableName: z.string(),
  lastFlushedId: z.number().int().default(0),
  lastProcessedId: z.number().int().default(0),
  pendingCount: z.number().default(0),
  lastFlushTime: z.number().optional(),
  lastProcessTime: z.number().optional(),
  updatedAt: z.number().default(Date.now)
});

type TableState = z.infer<typeof TableStateSchema>;

export class UserDO extends DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  protected database: UserDODatabase;
  private scaleConfig: ScaleConfig = DEFAULT_SCALE_CONFIGS['1M+'];
  private sendFailureCount = new WeakMap<WebSocket, number>();
  private sessions = new WeakMap<WebSocket, string>();
  private tableStates = new Map<string, TableState>();
  
  private readonly QUEUE_TABLE_NAMES = [
    "service_usages", "orders", "order_items", "order_discounts", 
    "payments", "refunds"
  ];

  private readonly TABLE_CONFIGS = {
    userScoped: { userScoped: true, autoFields: { id: true, timestamps: true, user: true } },
    withUniqueIndex: (conflictField: string) => ({
      userScoped: true,
      uniqueIndexes: [conflictField],
      conflictField,
      autoFields: { id: true, timestamps: true, user: true }
    }),
    queueTable: () => ({
      userScoped: true,
      autoFields: { id: true, timestamps: true, user: true, queue: true }
    })
  };

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.database = new UserDODatabase(state.storage, this.userId, this.broadcast.bind(this));
    
    this.initializeTables();
  }

  // ========== INITIALIZATION ==========
  private async initializeTables(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      // Core tables
      this.table('price_policies', PricePolicySchema, this.TABLE_CONFIGS.withUniqueIndex('code'));
      this.table('services', ServiceSchema, this.TABLE_CONFIGS.withUniqueIndex('endpoint'));
      this.table('vouchers', VoucherSchema, this.TABLE_CONFIGS.withUniqueIndex('code'));
      
      // User tables
      this.table('users', UserSchema, this.TABLE_CONFIGS.withUniqueIndex('identifier'));
      this.table('sessions', SessionSchema, this.TABLE_CONFIGS.withUniqueIndex('hashSessionId'));
      this.table('connections', ConnectionSchema, this.TABLE_CONFIGS.withUniqueIndex('sessionId'));
      this.table('subscriptions', SubscriptionSchema, this.TABLE_CONFIGS.withUniqueIndex('channel'));
      
      // Queue tables với extended schema
      const queueSchemas = [
        { name: 'orders', schema: OrderSchema },
        { name: 'service_usages', schema: ServiceUsageSchema },
        { name: 'order_items', schema: OrderItemSchema },
        { name: 'order_discounts', schema: OrderItemDiscountSchema },
        { name: 'payments', schema: PaymentSchema },
        { name: 'refunds', schema: RefundSchema }
      ];
      
      queueSchemas.forEach(({ name, schema }) => {
        const extendedSchema = schema.extend({
          queueId: z.number().int().optional(),
          queueStatus: z.enum(['pending', 'flushed', 'processed']).optional(),
          flushedAt: z.number().optional(),
          processedAt: z.number().optional()
        });
        this.table(name, extendedSchema, this.TABLE_CONFIGS.queueTable());
      });
      
      // Other tables
      this.table('api_tokens', ApiTokenSchema, this.TABLE_CONFIGS.userScoped);
      this.table('versions', VersionInfoSchema, this.TABLE_CONFIGS.userScoped);
      this.table('pending_messages', PendingMessageSchema, this.TABLE_CONFIGS.userScoped);
      
      // Initialize states and alarms
      await this.loadTableStates();
      await this.scheduleQueueAlarmIfNeeded();
    });
  }

  // ========== GETTERS & DATABASE ==========
  get userId(): string { return this.state.id.toString(); }
  get storage(): DurableObjectStorage { return this.state.storage; }
  
  private table<T extends z.ZodSchema>(name: string, schema: T, options?: TableOptions) {
    return this.database.table(name, schema, options);
  }

  // ========== TABLE STATE MANAGEMENT ==========
  private async loadTableStates(): Promise<void> {
    for (const tableName of this.QUEUE_TABLE_NAMES) {
      const storedState = await this.storage.get<TableState>(`table_state_${tableName}`);
      
      if (storedState) {
        this.tableStates.set(tableName, storedState);
      } else {
        const initialState: TableState = {
          tableName,
          lastFlushedId: 0,
          lastProcessedId: 0,
          pendingCount: 0,
          updatedAt: Date.now()
        };
        this.tableStates.set(tableName, initialState);
        await this.saveTableState(tableName);
      }
    }
  }

  private async saveTableState(tableName: string): Promise<void> {
    const state = this.tableStates.get(tableName);
    if (state) {
      state.updatedAt = Date.now();
      await this.storage.put(`table_state_${tableName}`, state);
    }
  }

  private async updateTableState(
    tableName: string, 
    updates: Partial<TableState>
  ): Promise<void> {
    const state = this.tableStates.get(tableName);
    if (!state) return;

    Object.assign(state, updates);
    await this.saveTableState(tableName);
  }


  private async getPendingCount(tableName: string): Promise<number> {
    const countResult = await this.database.execSelectSQL(
      `SELECT COUNT(*) as count FROM ${tableName} WHERE queueStatus = 'pending'`
    );
    return countResult[0]?.count || 0;
  }

  private shouldFlushTable(tableName: string): boolean {
    const state = this.tableStates.get(tableName);
    if (!state) return false;

    const now = Date.now();
    const lastFlushTime = state.lastFlushTime || 0;
    const flushInterval = parseInt(this.env.QUEUE_FLUSH_INTERVAL || QUEUE_FLUSH_INTERVAL.toString());
    const flushThreshold = parseInt(this.env.QUEUE_FLUSH_THRESHOLD || QUEUE_FLUSH_THRESHOLD.toString());

    return state.pendingCount >= flushThreshold || (now - lastFlushTime) > flushInterval;
  }

  // ========== FETCH HANDLER ==========
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.headers.get('Upgrade') === 'websocket') {
        return await this.handleWebSocketUpgrade(request);
      }

      const url = new URL(request.url);
      if (url.hostname === 'user.internal') {
        return await this.handleInternalMessage(request);
      }

      const routeHandlers: Record<string, (req: Request) => Promise<Response>> = {
        '/status': () => this.getWebsocketStatus(),
        '/subscriptions': () => this.getSubscriptionList(),
        '/dynamic/insert': (req) => this.handleDynamicInsert(req),
        '/dynamic/update': (req) => this.handleDynamicUpdate(req),
        '/dynamic/upsert': (req) => this.handleDynamicUpsert(req),
        '/dynamic/delete': (req) => this.handleDynamicDelete(req),
        '/dynamic/select': (req) => this.handleDynamicSelect(req),
        '/dynamic/batch-insert': (req) => this.handleDynamicBatchInsert(req),
        '/dynamic/multi-table': (req) => this.handleDynamicMultiTable(req),
        '/queue/record': (req) => this.handleQueueRecord(req),
        '/queue/flush': (req) => this.handleQueueFlush(req),
        '/queue/stats': () => this.handleQueueStats(),
        '/queue/health': () => this.handleQueueHealth(),
        '/queue/cleanup': (req) => this.handleQueueCleanup(req)
      };

      const handler = routeHandlers[url.pathname];
      if (handler) {
        return await handler(request);
      }

      throw new Error(`Unknown path: ${url.pathname}`);
    } catch (error) {
      handleErrorWithoutIp(error, `UserDO ${this.userId} fetch error`);
      return this.jsonResponse({ success: false, error: 'Internal Server Error' }, 500);
    }
  }

  // ========== DYNAMIC OPERATIONS ==========
  private async handleDynamicInsert(request: Request): Promise<Response> {
    const { table, data } = await request.json() as { table: string; data: any };
    
    if (this.isQueueTable(table)) {
      return await this.handleQueueInsert(table, data);
    }
    
    const result = await this.database.dynamicInsert(table, data);
    return this.jsonResponse({ success: true, data: result });
  }

  private async handleQueueInsert(tableName: string, data: any): Promise<Response> {
    
    const result = await this.database.dynamicInsert(tableName, data);
    
    await this.updateTablePendingCount(tableName);
    
    if (this.shouldFlushTable(tableName)) {
      this.state.waitUntil(this.flushPendingRecords(tableName));
    }
    
    return this.jsonResponse({ 
      success: true, 
      data: result,
      idInfo: { id: result.id, tableState: this.tableStates.get(tableName) }
    });
  }

  private async handleDynamicUpdate(request: Request): Promise<Response> {
    const { table, id, data } = await request.json() as { table: string; id: number; data: any };
    
    if (this.isQueueTable(table)) {
      
      const result = await this.database.dynamicUpdate(table, id, data);
      
      await this.updateTablePendingCount(table);
      
      if (this.shouldFlushTable(table)) {
        this.state.waitUntil(this.flushPendingRecords(table));
      }
      
      return this.jsonResponse({ 
        success: true, 
        data: result,
        id: id
      });
    }
    
    const result = await this.database.dynamicUpdate(table, id, data);
    return this.jsonResponse({ success: true, data: result });
  }

  private async handleDynamicUpsert(request: Request): Promise<Response> {
    const { table, data, conflictField } = await request.json() as { 
      table: string; 
      data: any; 
      conflictField?: string 
    };
    
    if (this.isQueueTable(table)) {
      
      const result = await this.database.dynamicUpsert(table, data, conflictField);
      
      await this.updateTablePendingCount(table);
      
      if (this.shouldFlushTable(table)) {
        this.state.waitUntil(this.flushPendingRecords(table));
      }
      
      return this.jsonResponse({ 
        success: true, 
        data: result,
        id: result.id
      });
    }
    
    const result = await this.database.dynamicUpsert(table, data, conflictField);
    return this.jsonResponse({ success: true, data: result });
  }

  private async handleDynamicDelete(request: Request): Promise<Response> {
    const { table, id, where } = await request.json() as { 
      table: string; 
      id?: number; 
      where?: { field: string; operator: string; value: any } 
    };
    
    if (id) {
      await this.database.dynamicDelete(table, id);
    } else if (where) {
      const records = await this.database.dynamicSelect(table, where);
      for (const record of records) {
        await this.database.dynamicDelete(table, record.id);
      }
    } else {
      throw new Error('Either id or where condition is required');
    }
    
    if (this.isQueueTable(table)) {
      await this.updateTablePendingCount(table);
    }
    
    return this.jsonResponse({ success: true });
  }

  private async handleDynamicSelect(request: Request): Promise<Response> {
    const { table, where, orderBy, limit } = await request.json() as {
      table: string;
      where?: { field: string; operator: string; value: any };
      orderBy?: { field: string; direction: 'ASC' | 'DESC' };
      limit?: number;
    };
        
    const result = await this.database.dynamicSelect(table, where, orderBy, limit);
    return this.jsonResponse({ success: true, data: result });
  }

  private async handleDynamicBatchInsert(request: Request): Promise<Response> {
    const { table, data } = await request.json() as { table: string; data: any[] };
    
    if (this.isQueueTable(table)) {
      const results = await Promise.all(
        data.map(record => 
          this.database.dynamicInsert(table, record)
        )
      );
      
      await this.updateTablePendingCount(table);
      
      if (this.shouldFlushTable(table)) {
        this.state.waitUntil(this.flushPendingRecords(table));
      }
      
      return this.jsonResponse({ 
        success: true, 
        data: results,
        batchInfo: { recordCount: data.length, tableState: this.tableStates.get(table) }
      });
    }
    
    const result = await this.database.dynamicBatchInsert(table, data);
    return this.jsonResponse({ success: true, data: result });
  }

  private async handleDynamicMultiTable(request: Request): Promise<Response> {
    const { operations } = await request.json() as {
      operations: Array<{
        table: string;
        operation: 'insert' | 'update' | 'upsert' | 'delete';
        data?: any;
        id?: number;
        conflictField?: string;
        where?: { field: string; operator: string; value: any };
      }>;
    };
    
    
    const result = await this.database.dynamicMultiTableTransaction(operations);
    
    const updatedTables = new Set(
      operations
        .filter(op => this.isQueueTable(op.table))
        .map(op => op.table)
    );
    
    for (const tableName of updatedTables) {
      await this.updateTablePendingCount(tableName);
      if (this.shouldFlushTable(tableName)) {
        this.state.waitUntil(this.flushPendingRecords(tableName));
      }
    }
    
    return this.jsonResponse({ success: true, data: result });
  }

  // ========== QUEUE MANAGEMENT ==========
  private async handleQueueRecord(request: Request): Promise<Response> {
    const { table, data, operation = "insert" } = await request.json() as {
      table: string;
      data: any;
      operation?: "insert" | "update" | "upsert" | "delete";
    };
    
    if (!this.isQueueTable(table)) {
      return this.jsonResponse({ error: `Table ${table} not found` }, 400);
    }

    let result: any;
    
    switch (operation) {
      case "insert":
        result = await this.database.dynamicInsert(table, data);
        break;
      case "update":
        result = await this.database.dynamicUpdate(table, data.id, data);
        break;
      case "upsert":
        result = await this.database.dynamicUpsert(table, data);
        break;
      case "delete":
        await this.database.dynamicDelete(table, data.id);
        result = { deleted: true };
        break;
    }

    await this.updateTablePendingCount(table);

    if (this.shouldFlushTable(table)) {
      this.state.waitUntil(this.flushPendingRecords(table));
    }

    return this.jsonResponse({ 
      success: true, 
      data: result,
      idInfo: { id: result?.id, tableState: this.tableStates.get(table) }
    });
  }

  private async handleQueueFlush(request: Request): Promise<Response> {
    const { table, force = false } = await request.json() as {
      table?: string;
      force?: boolean;
    };
    
    if (table) {
      if (!this.isQueueTable(table)) {
        return this.jsonResponse({ error: `Table ${table} is not a queue table` }, 400);
      }
      
      await this.flushPendingRecords(table, force);
      return this.jsonResponse({ 
        success: true,
        table,
        message: `Flushed pending records for ${table}`,
        tableState: this.tableStates.get(table)
      });
    }
    
    const results = [];
    for (const tableName of this.QUEUE_TABLE_NAMES) {
      if (force || this.shouldFlushTable(tableName)) {
        await this.flushPendingRecords(tableName, force);
        results.push({
          table: tableName,
          flushed: true,
          tableState: this.tableStates.get(tableName)
        });
      }
    }
    
    return this.jsonResponse({ 
      success: true,
      results,
      message: `Flushed ${results.length} tables`
    });
  }

  private async handleQueueCleanup(request: Request): Promise<Response> {
    try {
      const { table, cleanupMethod = 'delete', upToId } = await request.json() as {
        table: string;
        cleanupMethod: 'delete' | 'mark';
        upToId: number;
      };
      
      if (!this.isQueueTable(table)) {
        return this.jsonResponse({ 
          success: false, 
          error: `Table ${table} is not a queue table` 
        }, 400);
      }
      
      const result = await this.cleanupProcessedRecords(table, cleanupMethod, upToId);
      
      return this.jsonResponse({
        success: true,
        data: result,
        message: `Cleaned up processed records for table ${table} using method: ${cleanupMethod}`
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Queue cleanup error for UserDO ${this.userId}`);
      return this.jsonResponse({ 
        success: false, 
        error: 'Cleanup failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }

  // ========== QUEUE FLUSH LOGIC ==========
  private async flushPendingRecords(tableName: string, force: boolean = false): Promise<void> {
    const state = this.tableStates.get(tableName);
    if (!state) return;

    try {
      const pendingRecords = await this.database.execSelectSQL(
        `SELECT * FROM ${tableName} 
         WHERE queueStatus = 'pending' 
         ORDER BY queueId ASC
         LIMIT ${QUEUE_FLUSH_THRESHOLD}`
      );

      if (pendingRecords.length === 0) return;

      const maxId = Math.max(...pendingRecords.map(r => r.queueId));

      await this.env.INPUT_QUEUE.send(
        pendingRecords.map(record => ({
          body: JSON.stringify({
            table: tableName,
            schema: this.database.getTableConfig(tableName)?.schema,
            data: record,
            id: record.queueId,
            batchInfo: {
              userId: this.userId,
              table: tableName,
              batchSize: pendingRecords.length,
              minId: pendingRecords[0].queueId,
              maxId,
              previousFlushedId: state.lastFlushedId,
              timestamp: Date.now()
            }
          })
        }))
      );

      await this.markRecordsAsFlushed(tableName, state.lastFlushedId, maxId);
      await this.updateTableState(tableName, { 
        lastFlushedId: maxId, 
        lastFlushTime: Date.now(),
        pendingCount: await this.getPendingCount(tableName)
      });

      console.log(`[UserDO ${this.userId}] Flushed ${pendingRecords.length} records from ${tableName}, up to id ${maxId}`);

    } catch (error) {
      console.error(`[UserDO ${this.userId}] Failed to flush records from ${tableName}:`, error);
      
      this.state.waitUntil(
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.flushPendingRecords(tableName, force);
        })()
      );
    }
  }

  private async markRecordsAsFlushed(tableName: string, fromId: number, toId: number): Promise<number> {
    console.log(`UPDATE ${tableName} 
            SET queueStatus = 'flushed', flushedAt = ${Date.now()} 
            WHERE queueStatus = 'pending' 
            AND queueId > ${fromId}  
            AND queueId <= ${toId}`);
    await this.database.execTransaction([{
      sql: `UPDATE ${tableName} 
            SET queueStatus = 'flushed', flushedAt = ? 
            WHERE queueStatus = 'pending' 
            AND queueId > ? 
            AND queueId <= ?`,
      params: [Date.now(), fromId, toId]
    }]);
    
    const countResult = await this.database.execSelectSQL(
      `SELECT COUNT(*) as count FROM ${tableName} 
       WHERE queueStatus = 'flushed' 
       AND queueId > ? 
       AND queueId <= ?`,
      [fromId, toId]
    );
    
    return countResult[0]?.count || 0;
  }

  private async cleanupProcessedRecords(tableName: string, method: 'delete' | 'mark' = 'delete', upToId: number): Promise<{
    deletedCount: number;
    markedCount: number;
    table: string;
    timestamp: number;
    processedUpTo: number;
  }> {
    const state = this.tableStates.get(tableName);
    if (!state) {
      throw new Error(`Table state not found for ${tableName}`);
    }

    if (method === 'delete' && state.lastProcessedId < upToId) {
      const deletedCount = await this.deleteProcessedRecords(tableName, upToId);
      return { deletedCount, markedCount: 0, table: tableName, timestamp: Date.now(), processedUpTo: upToId };
    } else {
      const markedCount = await this.markRecordsAsProcessed(tableName, upToId);
      await this.updateTableState(tableName, { lastProcessedId: upToId });
      return { deletedCount: 0, markedCount, table: tableName, timestamp: Date.now(), processedUpTo: upToId };
    }
  }

  private async deleteProcessedRecords(tableName: string, upToId: number): Promise<number> {
    const countResult = await this.database.execSelectSQL(
      `SELECT COUNT(*) as count FROM ${tableName} 
       WHERE queueStatus = 'processed' 
       AND queueId <= ?`,
      [upToId]
    );
    
    const countToDelete = countResult[0]?.count || 0;
    
    if (countToDelete > 0) {
      await this.database.execTransaction([{
        sql: `DELETE FROM ${tableName} 
              WHERE queueStatus = 'processed' 
              AND queueId <= ?`,
        params: [upToId]
      }]);
      
      console.log(`[UserDO ${this.userId}] Deleted ${countToDelete} processed records from ${tableName}, up to id ${upToId}`);
    }
    
    return countToDelete;
  }

  private async markRecordsAsProcessed(tableName: string, upToId: number): Promise<number> {
    const countResult = await this.database.execSelectSQL(
      `SELECT COUNT(*) as count FROM ${tableName} 
       WHERE queueStatus = 'flushed' 
       AND queueId <= ?`,
      [upToId]
    );
    
    const countToMark = countResult[0]?.count || 0;
    if (countToMark > 0) {
      await this.database.execTransaction([{
        sql: `UPDATE ${tableName} SET queueStatus = 'processed'
              WHERE queueStatus = 'flushed' 
              AND queueId <= ?`,
        params: [upToId]
      }]);
      
      console.log(`[UserDO ${this.userId}] Marked ${countToMark} flushed records to processed in ${tableName}, up to id ${upToId}`);
    }
    
    return countToMark;
  }

  // ========== QUEUE STATS & HEALTH ==========
  private async handleQueueStats(): Promise<Response> {
    const now = Date.now();
    const stats: Record<string, any> = {};
    
    for (const tableName of this.QUEUE_TABLE_NAMES) {
      const state = this.tableStates.get(tableName);
      const statusStats = await this.getQueueStatusStats(tableName);
      
      stats[tableName] = {
        tableState: state,
        ...this.calculateTableMetrics(statusStats, now, state),
        shouldFlush: this.shouldFlushTable(tableName)
      };
    }

    return this.jsonResponse({
      success: true,
      data: stats,
      userId: this.userId,
      timestamp: now
    });
  }

  private async getQueueStatusStats(tableName: string): Promise<any[]> {
    return await this.database.execSelectSQL(`
      SELECT 
        queueStatus,
        COUNT(*) as count,
        MIN(queueId) as minId,
        MAX(queueId) as maxId
      FROM ${tableName}
      GROUP BY queueStatus
    `);
  }

  private calculateTableMetrics(statusStats: any[], now: number, state?: TableState) {
    const getStats = (status: string) => 
      statusStats.find(s => s.queueStatus === status) || { count: 0, minId: 0, maxId: 0 };
    
    const pending = getStats('pending');
    const flushed = getStats('flushed');
    const processed = getStats('processed');
    
    return {
      pending: {
        count: pending.count,
        minId: pending.minId,
        maxId: pending.maxId,
        ageSeconds: pending.maxId > 0 ? 
          Math.floor((now - (state?.lastFlushTime || now)) / 1000) : 0
      },
      flushed: { count: flushed.count, minId: flushed.minId, maxId: flushed.maxId },
      processed: { count: processed.count, minId: processed.minId, maxId: processed.maxId },
      totalRecords: statusStats.reduce((sum, s) => sum + s.count, 0),
      lastUpdated: now
    };
  }

  private async handleQueueHealth(): Promise<Response> {
    let totalPending = 0;
    let totalProcessed = 0;
    let unhealthyTables = 0;
    
    for (const tableName of this.QUEUE_TABLE_NAMES) {
      const state = this.tableStates.get(tableName);
      if (!state) continue;
      
      const [pendingResult, processedResult] = await Promise.all([
        this.database.execSelectSQL(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE queueStatus = 'pending'`,
          []
        ),
        this.database.execSelectSQL(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE queueStatus = 'processed'`,
          []
        )
      ]);
      
      totalPending += pendingResult[0]?.count || 0;
      totalProcessed += processedResult[0]?.count || 0;
      
      const oldPendingResult = await this.database.execSelectSQL(
        `SELECT COUNT(*) as count FROM ${tableName} 
         WHERE queueStatus = 'pending' 
         AND queueId <= ?`,
        [state.lastFlushedId]
      );
      
      if ((oldPendingResult[0]?.count || 0) > 0) {
        unhealthyTables++;
      }
    }
    
    const healthStatus = unhealthyTables > 0 ? 'warning' : 
                       totalPending > 1000 ? 'degraded' : 'healthy';
    
    return this.jsonResponse({
      success: true,
      status: healthStatus,
      queueEnabled: true,
      tablesCount: this.QUEUE_TABLE_NAMES.length,
      pendingTotal: totalPending,
      processedTotal: totalProcessed,
      unhealthyTables,
      userId: this.userId,
      timestamp: Date.now()
    });
  }

  // ========== ALARM HANDLER ==========
  async alarm() {
    try {
      await Promise.all([
        this.sendHeartbeat(),
        this.flushAllPendingRecords(),
        this.cleanupOldProcessedRecords()
      ]);
      
      if (this.state.getWebSockets().length > 0) {
        await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);
      }
    } catch (error) {
      handleErrorWithoutIp(error, "Alarm execution error");
    }
  }

  private async flushAllPendingRecords(): Promise<void> {
    const promises = this.QUEUE_TABLE_NAMES
      .filter(tableName => this.shouldFlushTable(tableName))
      .map(tableName => {
        console.log(`[UserDO ${this.userId}] Auto-flushing ${tableName}`);
        return this.flushPendingRecords(tableName);
      });
    
    await Promise.all(promises);
  }

  private async cleanupOldProcessedRecords(): Promise<void> {
    
    for (const tableName of this.QUEUE_TABLE_NAMES) {
      try {
        // Get the id of the last processed record
        const cutoffResult = await this.database.execSelectSQL(
          `SELECT MAX(queueId) as maxId FROM ${tableName} 
           WHERE queueStatus = 'processed'`);
        
        const cutoffId = cutoffResult[0]?.maxId || 0;
        
        if (cutoffId > 0) {
          const deleteResult = await this.database.execSelectSQL(
            `SELECT COUNT(*) as count FROM ${tableName} 
             WHERE queueStatus = 'processed' 
             AND queueId <= ?`,
            [cutoffId]
          );
          
          const countToDelete = deleteResult[0]?.count || 0;
          
          if (countToDelete > 0) {
            await this.database.execTransaction([{
              sql: `DELETE FROM ${tableName} 
                    WHERE queueStatus = 'processed' 
                    AND queueId <= ?`,
              params: [cutoffId]
            }]);
            
            console.log(`[UserDO ${this.userId}] Cleaned up ${countToDelete} old processed records from ${tableName}`);
            
            const state = this.tableStates.get(tableName);
            if (state && state.lastProcessedId <= cutoffId) {
              await this.updateTableState(tableName, { lastProcessedId: cutoffId });
            }
          }
        }
      } catch (error) {
        console.error(`[UserDO ${this.userId}] Error cleaning up old records from ${tableName}:`, error);
      }
    }
  }

  // ========== HELPER METHODS ==========
  private isQueueTable(tableName: string): boolean {
    return this.QUEUE_TABLE_NAMES.includes(tableName);
  }

  private async updateTablePendingCount(tableName: string): Promise<void> {
    const pendingCount = await this.getPendingCount(tableName);
    await this.updateTableState(tableName, { pendingCount });
  }

  private async scheduleQueueAlarmIfNeeded(): Promise<void> {
    const currentAlarm = await this.storage.getAlarm();
    if (currentAlarm === null) {
      await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);
    }
  }

  private jsonResponse(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ========== WEBSOCKET HANDLERS (giữ nguyên, nhưng đơn giản hóa) ==========
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    try {
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) throw new Error('Missing IP or user agent');
      
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      this.state.acceptWebSocket(server);
      const encryptSecret= await this.env.ENCRYPTION_SECRET.get();
      if (!encryptSecret) {
        throw new Error("ENCRYPTION_SECRET is not defined in environment variables");
      }

      const sessionId = getSessionIdHash(ipAddress, userAgent, encryptSecret);
      await this.database.dynamicInsert("connections", {
        connected: true, 
        lastConnected: Date.now(), 
        sessionId
      });      
      
      this.sessions.set(server, sessionId);
      this.state.waitUntil(Promise.all([
        this.registerUser(), 
        this.sendPendingMessages(server)
      ]));

      await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: new Headers({
          'X-WebSocket-Status': 'connected',
          'X-User-ID': this.userId,
          'X-Session-ID': sessionId
        })
      });      
    } catch (error) {
      const { errorResponse } = await handleErrorWithoutIp(error, 'WebSocket upgrade error');  
      return this.jsonResponse({
        success: false,
        error: "WebSocket connection failed",
        code: "WEBSOCKET_UPGRADE_FAILED",
        details: errorResponse,
        timestamp: Date.now()
      }, 500);      
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = WebSocketMessageSchema.parse(JSON.parse(data));
      await this.handleMessage(ws, parsed);
    } catch (e) {
      handleErrorWithoutIp(e, `Processing message error: ${message}`);
      await this.sendMessage(ws, { type: 'error', message: 'Invalid message format' });
    }
  }

  private async handleMessage(ws: WebSocket, message: z.infer<typeof WebSocketMessageSchema>) {
    const handlers: Record<string, () => Promise<void>> = {
      ping: async () => { await this.sendMessage(ws, { type: 'pong', timestamp: Date.now() }) },
      subscribe: async () => {
        if (message.channel) {
          await this.handleSubscribe(message.channel);
          await this.sendMessage(ws, { type: 'subscribed', channel: message.channel });
        }
      },
      unsubscribe: async () => {
        if (message.channel) {
          await this.handleUnsubscribe(message.channel);
          await this.sendMessage(ws, { type: 'unsubscribed', channel: message.channel });
        }
      }
    };

    const handler = handlers[message.type];
    if (handler) await handler();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try {
      this.sendFailureCount.delete(ws);
      const sessionId = this.sessions.get(ws);
      if (sessionId) {
        await this.database.execTransaction([{
          sql: 'UPDATE connections SET connected = false WHERE sessionId = ?',
          params: [sessionId]
        }]); 
      }
      this.sessions.delete(ws);      
      await this.unregisterUser();
      await this.storage.deleteAlarm();
    } catch (e) {
      handleErrorWithoutIp(e, "UserDO WebSocket closed error");
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    handleErrorWithoutIp(error, `UserDO ${this.userId} WebSocket error`);
    try { ws.close(1011, 'Internal server error'); } 
    catch (closeError) { handleErrorWithoutIp(closeError, "Close webSocket error"); }
  }

  // ========== MESSAGE & BROADCAST MANAGEMENT ==========
  private async sendMessage(ws: WebSocket, message: any): Promise<boolean> {
    try {
      if (ws.readyState !== WebSocket.OPEN) return false;
      
      const messageStr = JSON.stringify(message);
      if (messageStr.length > 1024 * 1024) return false;

      ws.send(messageStr);
      this.sendFailureCount.set(ws, 0);
      return true;
    } catch (error) {
      await this.handleSendError(ws, error, message);
      return false;
    }    
  }

  private async handleSendError(ws: WebSocket, error: any, message: any): Promise<void> {
    const currentFailures = this.sendFailureCount.get(ws) || 0;
    const newFailures = currentFailures + 1;
    this.sendFailureCount.set(ws, newFailures);
        
    if (!error.message?.includes("Invalid") && !error.message?.includes("too large")) {
      try { 
        const sessionId = this.sessions.get(ws);
        if (sessionId) {
          await this.storePendingMessage(sessionId, message); 
        }
      } catch (e) { 
        handleErrorWithoutIp(e, `Store pending message error: ${message}`); 
      }
    }

    if (newFailures >= MAX_SEND_FAILURE_COUNT) {
      try { ws.close(1011, 'Send failure'); } 
      catch (closeError) { handleErrorWithoutIp(closeError, "Close webSocket error"); }
    }
  }

  private async storePendingMessage(sessionId: string, message: any) {
    await this.database.dynamicInsert('pending_messages', {
      message: BroadcastValidator.sanitizeBroadcastMessage(message),
      type: message.type || 'unknown',
      priority: 'medium',
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: Date.now(),
      sessionId
    });
  }

  private async sendPendingMessages(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const sessionId = this.sessions.get(ws);  
    if (!sessionId) return;

    const pendingMessages = await this.database.execSelectSQL(
      'SELECT * FROM pending_messages WHERE sessionId = ? AND attempts < maxAttempts ORDER BY priority DESC, scheduledFor ASC',
      [sessionId]
    );
    
    for (const pendingMessage of pendingMessages) {
      if (await this.sendMessage(ws, pendingMessage.message)) {
        await this.database.dynamicDelete('pending_messages', pendingMessage.id);
      } else {
        break;
      }
    }
  }

  protected broadcast(event: string, data: any): void {
    const message = { event, data, timestamp: Date.now() };
    this.state.getWebSockets().forEach(ws => this.sendMessage(ws, message));
  }

  private async sendHeartbeat(): Promise<void> {
    const webSockets = this.state.getWebSockets();
    this.broadcast('heartbeat', { 
      type: 'periodic', 
      activeConnections: webSockets.length, 
      timestamp: Date.now()
    });
  }

  // ========== SUBSCRIPTION MANAGEMENT ==========
  private async handleSubscribe(channel: string) {
    await this.database.dynamicUpsert('subscriptions', {
      channel,
      subscribedAt: Date.now(),
      isActive: true
    });
  }

  private async handleUnsubscribe(channel: string) {
    await this.database.execTransaction([{
      sql: 'UPDATE subscriptions SET isActive = false WHERE channel = ?',
      params: [channel]
    }]);
  }

  private async getSubscriptions(): Promise<Subscription[]> {
    return await this.database.dynamicSelect('subscriptions', { 
      field: 'isActive', 
      operator: '=', 
      value: true 
    });    
  }

  // ========== INTERNAL MESSAGE HANDLER ==========
  private async handleInternalMessage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/repository/')) {
      return await this.handleRepositoryOperations(request, url.pathname);
    }

    const message = await request.json() as { type: string; [key: string]: any };
    if (message.type === 'broadcast') {
      await this.handleDirectBroadcast(message);
    }
    
    return this.jsonResponse({ success: true, status: 'processed' });
  }

  private async handleRepositoryOperations(request: Request, path: string): Promise<Response> {
    const data = await request.json() as any;
    
    switch (path) {
      case '/repository/transaction':
        await this.database.execTransaction(data.operations);
        return this.jsonResponse({ success: true });
        
      case '/repository/select':
        const result = await this.database.execSelectSQL(data.sql, data.params || [], data.table);
        return this.jsonResponse({ success: true, data: result });
                
      default:
        return this.jsonResponse({ success: false, error: 'Not found' }, 404);
    }
  }

  private async handleDirectBroadcast(message: any) {
    const { broadcastId, message: messageContent } = message;
    await this.broadcast("broadcast", messageContent);
    this.state.waitUntil(this.recordLocalDelivery(broadcastId));      
  }

  private async recordLocalDelivery(broadcastId: string) {
    const current = await this.storage.get<number>(`user_delivery_${broadcastId}`) || 0;
    const newCount = current + 1;
    await this.storage.put(`user_delivery_${broadcastId}`, newCount);

    if (newCount % 10 === 0) {
      this.state.waitUntil(this.reportDeliveryToShard(broadcastId, newCount));
    }
  }

  private async reportDeliveryToShard(broadcastId: string, deliveredCount: number) {
    const shardName = this.getShardForUser(this.userId);
    const shardDO = this.env.USER_SHARD_DO.get(this.env.USER_SHARD_DO.idFromName(shardName));
    
    await shardDO.fetch('https://shard.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'user_delivery_report',
        broadcastId,
        deliveredCount,
        userId: this.userId,
        timestamp: Date.now()
      })
    });
    
    await this.storage.delete(`user_delivery_${broadcastId}`);    
  }

  private getShardForUser(userId: string): string {
    const hash = this.consistentHash(userId, this.scaleConfig.SHARD_COUNT);
    return `shard-${hash}`;
  }

  private consistentHash(str: string, buckets: number): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % buckets;
  }

  // ========== USER REGISTRATION ==========
  private async registerUser() {
    const broadcastDO = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );

    const response = await broadcastDO.fetch('https://broadcast.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'registerUser', userId: this.userId })
    });
    
    if (!response.ok) throw new Error(`Failed to register user: ${response.statusText}`);
  }

  private async unregisterUser() {
    const broadcastDO = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );

    const response = await broadcastDO.fetch('https://broadcast.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregisterUser', userId: this.userId })
    });
    
    if (!response.ok) throw new Error(`Failed to unregister user: ${response.statusText}`);
  }

  async getWebsocketStatus() {
    const [pendingMessages, subscriptions, webSockets] = await Promise.all([
      this.database.dynamicSelect('pending_messages'),
      this.getSubscriptions(),
      this.state.getWebSockets()
    ]);

    const status = {
      userId: this.userId, 
      pendingMessages: pendingMessages.length,
      subscribedChannels: subscriptions.map(sub => sub.channel),
      activeConnections: webSockets.length,
      timestamp: Date.now()
    };

    return this.jsonResponse({ success: true, data: status });  
  }

  async getSubscriptionList(): Promise<Response> {
    const subscriptions = await this.getSubscriptions();
    return this.jsonResponse({ success: true, data: { subscriptions } });
  }
}