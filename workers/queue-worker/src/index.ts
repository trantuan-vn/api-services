import { D1DatabaseManager } from "./database";

// Cache database manager instance to avoid recreating it on every queue processing
let databaseManager: D1DatabaseManager | null = null;

const getDatabaseManager = (db: D1Database): D1DatabaseManager => {
  if (!databaseManager) {
    databaseManager = new D1DatabaseManager(db);
  }
  return databaseManager;
};

interface ProcessedItem {
  data: any;
  message: Message;
  userId: string;
  table: string;
  recordData: any;
  queueId?: number;
  batchInfo?: {
    userId: string;
    table: string;
    maxId?: number;
    minId?: number;
    [key: string]: any;
  };
  attempt: number;
}

interface CleanupResult {
  success: boolean;
  deletedCount?: number;
  markedCount?: number;
  processedUpTo?: number;
  error?: string;
}

const QUEUE_TABLE_NAMES = [
  "service_usages", "orders", "order_items",
  "order_discounts", "payments", "refunds"
];


// Helper functions

const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};





const cleanupProcessedRecords = async (
  userId: string,
  table: string,
  env: Env,
  cleanupMethod: 'delete' | 'mark' = 'delete',
  upToId: number
): Promise<CleanupResult> => {
  try {
    const doId = env.USER_DO.idFromString(userId);
    const stub = env.USER_DO.get(doId);

    const response = await stub.fetch('https://do.internal/queue/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table,
        cleanupMethod,
        upToId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cleanup records: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as any;
    console.log(`[QueueWorker] Cleaned up records from ${userId}/${table}, method: ${cleanupMethod}, upToId: ${upToId}`);

    return {
      success: true,
      deletedCount: result.data?.deletedCount,
      markedCount: result.data?.markedCount,
      processedUpTo: result.data?.processedUpTo
    };
  } catch (error) {
    console.error(`[QueueWorker] Failed to cleanup from UserDO ${userId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const processChunk = async (
  userId: string,
  table: string,
  chunk: ProcessedItem[],
  database: D1DatabaseManager,
  env: Env
): Promise<void> => {
  try {
    // Get maxId from batchInfo (if available) for cleanup
    const batchInfo = chunk[0]?.batchInfo;
    let maxId = batchInfo?.maxId;
    if (!maxId || maxId <= 0) {
      const queueIds = chunk.map(item => item.queueId || 0).filter(id => id > 0);
      maxId = queueIds.length > 0 ? Math.max(...queueIds) : 0;
    }
    
    // Prepare data array for batch insert (keep original id from message)
    const dataArray = chunk.map(item => item.recordData);
    
    // Batch insert all records into D1 (preserves id from message)
    await database.batchInsertRecords(table, dataArray);

    // After successful insert, cleanup records from UserDO
    if (maxId > 0) {
      try {
        // First mark as processed
        await cleanupProcessedRecords(userId, table, env, 'mark', maxId);        
        console.log(`[QueueWorker] Cleaned up records up to id ${maxId} from ${userId}/${table}`);
      } catch (error) {
        console.error(`[QueueWorker] Cleanup failed for ${userId}/${table}:`, error);
        // Still ack since D1 insert succeeded
      }
    }

    // All successful, ack all messages
    ackAllMessages(chunk);
    console.log(`[QueueWorker] Inserted ${chunk.length} records into D1 from ${userId}/${table}`);
  } catch (error) {
    console.error(`[QueueWorker] Failed to process chunk from ${userId}/${table}:`, error);
    retryAllMessages(chunk);
  }
};


const ackAllMessages = (chunk: ProcessedItem[]): void => {
  chunk.forEach(item => item.message.ack());
};

const retryAllMessages = (chunk: ProcessedItem[]): void => {
  chunk.forEach(item => item.message.retry());
};


const parseMessage = (message: Message): {
  userId: string;
  table: string;
  recordData: any;
  queueId?: number;
  batchInfo?: any;
}[] | null => {
  try {
		const dataArr = message.body as any[];
		// Kiểm tra nếu không phải array
    if (!Array.isArray(dataArr)) {
      console.warn('[QueueWorker] message.body is not an array:', message.body);
      return null;
    }
		let returnArr = [];
		for (const item of dataArr) {
			const parsedBody = JSON.parse(item.body);
			const userId = parsedBody.batchInfo?.userId;
			const table = parsedBody.batchInfo?.table || parsedBody.table;
			const recordData = parsedBody.data || parsedBody;
			const queueId = parsedBody.id || recordData.queueId;

			if (!userId || userId === 'unknown') {
				console.warn('[QueueWorker] Missing userId:', JSON.stringify(parsedBody));
				return null;
			}

			if (!QUEUE_TABLE_NAMES.includes(table)) {
				console.warn(`[QueueWorker] Table ${table} is not a queue table`);
				return null;
			}
			returnArr.push({
				userId,
				table,
				recordData,
				queueId: queueId ? (typeof queueId === 'string' ? parseInt(queueId) : queueId) : undefined,
				batchInfo: parsedBody.batchInfo
			});
		}

    return returnArr;
  } catch (error) {
    console.error('[QueueWorker] Failed to parse message:', error);
    return null;
  }
};

const processInputQueue = async (batch: MessageBatch, env: Env): Promise<void> => {
  const BATCH_SIZE = parseInt(env.BATCH_SIZE || '100');
  const database = getDatabaseManager(env.D1DB);
  const userTableGroups = new Map<string, Map<string, ProcessedItem[]>>();

  // Group messages by userId and table
  for (const message of batch.messages) {
    const parsed = parseMessage(message);
    if (!parsed) {
      message.ack();
      continue;
    }
		for (const parsedItem of parsed) {
			const { userId, table, recordData } = parsedItem;

			if (!userTableGroups.has(userId)) {
				userTableGroups.set(userId, new Map());
			}

			const tableMap = userTableGroups.get(userId)!;
			if (!tableMap.has(table)) {
				tableMap.set(table, []);
			}

			tableMap.get(table)!.push({
				data: { recordData },
				message,
				userId,
				table,
				recordData,
				queueId: parsedItem.queueId,
				batchInfo: parsedItem.batchInfo,
				attempt: 0
			});
		}
  }

  // Process all chunks
  const processingPromises: Promise<void>[] = [];

  for (const [userId, tableMap] of userTableGroups) {
    for (const [table, messages] of tableMap) {
      const chunks = chunkArray(messages, BATCH_SIZE);
      chunks.forEach(chunk => {
        processingPromises.push(processChunk(userId, table, chunk, database, env));
      });
    }
  }

  // Wait for all processing to complete
  const results = await Promise.allSettled(processingPromises);

  // Log results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log(`[QueueWorker] Batch complete: ${successful} successful, ${failed} failed`);

  // Log errors
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[QueueWorker] Chunk ${index} failed:`, result.reason);
    }
  });
};

const processErrorQueue = async (batch: MessageBatch, env: Env): Promise<void> => {
  console.log(`[QueueWorker] Processing ${batch.messages.length} DLQ messages`);

  for (const message of batch.messages) {
    try {
      const parsed = parseMessage(message);
      if (!parsed) {
        console.error(`[QueueWorker] Failed to parse message: ${message.id}`);  
        message.ack();
        continue;
      }
      for (const parsedItem of parsed) {
        console.error(`[QueueWorker] DLQ Entry: ${JSON.stringify(parsedItem)}`);  
      }
      message.ack();
    } catch (error) {
      console.error(`[QueueWorker] Failed to process DLQ message with id (${message.id}): ${error}`);       
      message.ack();
    }
  }
};

// HTTP Handler
const handleHttpRequest = async (req: Request, env: Env): Promise<Response> => {
  const url = new URL(req.url);

  const routes: Record<string, (req: Request) => Promise<Response>> = {
    '/health': async () => new Response(JSON.stringify({
      status: 'healthy',
      service: 'Queue Worker',
      timestamp: Date.now(),
      environment: env.ENVIRONMENT || 'production'
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    }),

    '/metrics': async () => new Response(JSON.stringify({
      queues: { input: 'input-part-0', error: 'error-queue-dlq' },
      settings: {
        batch_size: env.BATCH_SIZE || '100',
        max_retries: env.MAX_RETRIES || '3'
      },
      queue_tables: QUEUE_TABLE_NAMES
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    }),

    '/stats': async () => new Response(JSON.stringify({
      queue_worker: {
        version: '3.0.0',
        timestamp: Date.now(),
        queue_table_count: QUEUE_TABLE_NAMES.length,
        processing_model: 'd1-insert'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    }),

  };

  const handler = routes[url.pathname];
  if (handler) {
    return await handler(req);
  }

  return new Response('Queue Worker - Available: /health, /metrics, /stats', {
    headers: { 'Content-Type': 'text/plain' }
  });
};

// Main Export
export default {

  async fetch(req: Request, env: Env): Promise<Response> {
    return handleHttpRequest(req, env);
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    console.log(`[QueueWorker] Processing ${batch.queue} with ${batch.messages.length} messages`);

    const queueHandlers: Record<string, (batch: MessageBatch, env: Env) => Promise<void>> = {
      'input-part-0': processInputQueue,
      'error-queue-dlq': processErrorQueue
    };

    const handler = queueHandlers[batch.queue];
    if (handler) {
      await handler(batch, env);
    } else {
      console.warn(`[QueueWorker] Unknown queue: ${batch.queue}`);
      batch.messages.forEach(msg => msg.ack());
    }
  }
} as ExportedHandler<Env>;
