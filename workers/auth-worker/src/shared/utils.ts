import { Context } from 'hono'
import CryptoJS from 'crypto-js';
import { UserDO } from '../features/ws/infrastructure/UserDO';

export const handleError = async (c: Context, e: any, defaultMessage: string) => {
  try {
    // Tách các thông tin thường gặp trong Error object
    const message = e?.message || String(e);
    const stack = e?.stack;
    const name = e?.name;
    const cause = e?.cause;

    // Nếu là lỗi từ Axios hoặc Fetch, có thể có response
    const responseData = e?.response?.data;
    const responseStatus = e?.response?.status;
    const responseText = e?.response?.statusText;

    // Gom toàn bộ thông tin chi tiết
    const details = {
      name,
      message,
      stack,
      cause,
      response: responseData
        ? { status: responseStatus, statusText: responseText, data: responseData }
        : undefined,
      raw: typeof e === "object" ? e : String(e),
    };  
    
    const errorLog = {
      error: `${defaultMessage}: ${message}`,
      details,
    };
    console.error("❌ [ErrorHandler]", JSON.stringify(errorLog, null, 2));

    const errorResponse = { error: `${defaultMessage}: ${message}`};

    const ip= getClientIp(c);
    const ipData = await c.env.NONCE_KV.get(ip);
    let failCount = 1;
    let blockDuration = 5 * 60 * 1000; // 5 phút
    
    if (ipData) {
      const data = JSON.parse(ipData);
      failCount = data.failCount + 1;
      
      // Tăng thời gian chặn theo số lần
      if (failCount >= 6) blockDuration = 15 * 60 * 1000; // 15 phút
      if (failCount >= 10) blockDuration = 60 * 60 * 1000; // 1 giờ
      if (failCount >= 15) blockDuration = 24 * 60 * 60 * 1000; // 24 giờ
      
    }
    
    const blockData = {
      failCount: failCount,
      blockUntil: Date.now() + blockDuration,
      lastAttempt: Date.now()
    };
    
    await c.env.NONCE_KV.put(ip, JSON.stringify(blockData), {
      expirationTtl: 24 * 60 * 60 // TTL 24 giờ
    });  
    
    return { errorResponse, status: 400 as const };
  } catch (error) {
    console.error("❌ [ErrorHandler]", error);
    return { errorResponse: { error: `${defaultMessage}`}, status: 400 as const };
  }
};

export const handleErrorWithoutIp = async (e: any, defaultMessage: string) => {
  try {
    // Tách các thông tin thường gặp trong Error object
    const message = e?.message || String(e);
    const stack = e?.stack;
    const name = e?.name;
    const cause = e?.cause;

    // Nếu là lỗi từ Axios hoặc Fetch, có thể có response
    const responseData = e?.response?.data;
    const responseStatus = e?.response?.status;
    const responseText = e?.response?.statusText;

    // Gom toàn bộ thông tin chi tiết
    const details = {
      name,
      message,
      stack,
      cause,
      response: responseData
        ? { status: responseStatus, statusText: responseText, data: responseData }
        : undefined,
      raw: typeof e === "object" ? e : String(e),
    };  
    
    const errorLog = {
      error: `${defaultMessage}: ${message}`,
      details,
    };
    console.error("❌ [ErrorHandler]", JSON.stringify(errorLog, null, 2));

    const errorResponse = { error: `${defaultMessage}`};
    
    return { errorResponse, status: 400 as const };
  } catch (error) {
    console.error("❌ [ErrorHandler]", error);
    return { errorResponse: { error: `${defaultMessage}`}, status: 400 as const };
  }
};

export const parseBody = async (c: Context, schema: any) => {
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    return schema.parse(await c.req.json());
  } else {
    const formData = await c.req.formData();
    const entries: { [key: string]: any } = {};
    formData.forEach((value, key) => {
      entries[key] = value;
    });
    return schema.parse(entries);
  }
};

export function getIdFromName(c: Context, identifier: string, bindingName: string): DurableObjectStub {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromName(identifier);
  return binding.get(doID); // as unknown as T;
}

export function getIdFromString(c: Context, id: string, bindingName: string): DurableObjectStub {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromString(id);
  return binding.get(doID); // as unknown as T;
}

export function isAdmin(identifier: string) {
  return identifier === 'tuanta2021@gmail.com';
}

export function getIPAndUserAgent(request: Request) {
  const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || request.headers.get('X-Forwarded-For');
  const userAgent = request.headers.get('User-Agent') || 'apiToken';
  return { ipAddress, userAgent };
}

export const getSessionIdHash = (ipAddress: string, userAgent: string, secret: string) => {
  const data = `${ipAddress}|${userAgent}|${secret}`;
  return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

export const getClientIp = (c: any): string => {
  return c.req.raw.headers.get('CF-Connecting-IP') || c.req.raw.headers.get('X-Real-IP') || c.req.raw.headers.get('X-Forwarded-For');
};

export const executeUtils = {
  /**
   * Execute dynamic database operations
   */
  async executeDynamicAction(userDO: DurableObjectStub<UserDO>, operation: string, data: any, table?: string): Promise<any> {
    let endpoint = '';
    let requestData: any = {};

    // Xác định endpoint và dữ liệu dựa trên operation
    switch (operation) {
      case 'insert':
        endpoint = '/dynamic/insert';
        requestData = { table, data };
        break;
        
      case 'update':
        endpoint = '/dynamic/update';
        requestData = { table, id: data.id, data };
        break;
        
      case 'upsert':
        endpoint = '/dynamic/upsert';
        requestData = { table, data, conflictField: data.conflictField };
        break;
        
      case 'delete':
        endpoint = '/dynamic/delete';
        requestData = { table, id: data.id, where: data.where };
        break;
        
      case 'select':
        endpoint = '/dynamic/select';
        requestData = { 
          table, 
          where: data.where, 
          orderBy: data.orderBy, 
          limit: data.limit 
        };
        break;
        
      case 'batch-insert':
        endpoint = '/dynamic/batch-insert';
        requestData = { table, data };
        break;
        
      case 'multi-table':
        endpoint = '/dynamic/multi-table';
        requestData = { operations: data.operations };
        break;
        
      default:
        throw new Error(`Unsupported dynamic operation: ${operation}`);
    }

    const response = await userDO.fetch(`https://user.do${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute dynamic ${operation}: ${errorText}`);
    }
    
    const result = await response.json() as any;
    if (!result.success){
      throw new Error(result.error);
    }
    return result.data;

  },

  /**
   * Execute database transaction
   */
  async executeTransaction(userDO: DurableObjectStub<UserDO>, operations: Array<{sql: string, params: any[]}>): Promise<void>{
    const response = await userDO.fetch('http://user.internal/repository/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute transaction: ${errorText}`);
    }
    
    const result = await response.json() as any;
    if (!result.success){
      throw new Error(result.error);
    }
  },

  async executeRepositorySelect(userDO: DurableObjectStub<UserDO>, sql: string, params: any[] = [], table?: string): Promise<any[]> {
    const response = await userDO.fetch('http://user.internal/repository/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params, table: table || '' })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }
    
    const result = await response.json() as any;
    if (!result.success){
      throw new Error(result.error);
    }
    return result.data;
  },

};
// Ví dụ sử dụng:
/*
// INSERT
await executeDynamicAction(userDO, 'insert', sessionData, 'sessions');

// UPDATE
await executeDynamicAction(userDO, 'update', { id: '123', isActive: true }, 'sessions');

// UPSERT
await executeDynamicAction(userDO, 'upsert', 
  { email: 'test@example.com', name: 'Test User' }, 
  'users'
);

// DELETE
await executeDynamicAction(userDO, 'delete', { id: '123' }, 'users');

// SELECT với điều kiện
await executeDynamicAction(userDO, 'select', {
  where: { field: 'status', operator: '==', value: 'active' },
  orderBy: { field: 'createdAt', direction: 'DESC' },
  limit: 10
}, 'users');

// BATCH INSERT
await executeDynamicAction(userDO, 'batch-insert', [
  { name: 'User1', email: 'user1@test.com' },
  { name: 'User2', email: 'user2@test.com' }
], 'users');

// MULTI-TABLE TRANSACTION
await executeDynamicAction(userDO, 'multi-table', {
  operations: [
    {
      table: 'users',
      operation: 'insert',
      data: { name: 'John', email: 'john@test.com' }
    },
    {
      table: 'orders', 
      operation: 'insert',
      data: { userId: '123', amount: 100 }
    }
  ]
});
*/