import { z } from 'zod';

import {
	PricePolicySchema,
	ServiceSchema,
	VoucherSchema,
	UserSchema,
	SessionSchema,
	ConnectionSchema,
	SubscriptionSchema,
	OrderSchema,
	ServiceUsageSchema,
	OrderItemSchema,
	OrderItemDiscountSchema,
	PaymentSchema,
	RefundSchema,
	ApiTokenSchema,
	VersionInfoSchema,
	PendingMessageSchema,
} from '@auth-worker/features/ws/domain.js';

export interface TableOptions {
  userScoped?: boolean;
  organizationScoped?: boolean;
  indexes?: string[];
  uniqueIndexes?: string[];
  autoFields?: {
    id?: boolean;
    timestamps?: boolean;
    user?: boolean;
    organization?: boolean;
    queue?: boolean;
  };
  conflictField?: string;
}

export interface TableConfig {
  schema: z.ZodSchema;
  options: TableOptions;
}

export interface DynamicOperation {
  sql: string;
  params: any[];
}

export class DynamicSchemaManager {
  static createInsertOperation(table: string, data: any): DynamicOperation {
    const fields = Object.keys(data);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(field => data[field]);

    return {
      sql: `INSERT INTO "${table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${placeholders})`,
      params: values
    };
  }

  static createUpdateOperation(
    table: string,
    id: number,
    data: any,
  ): DynamicOperation {
    const fields = Object.keys(data);
    const setClause = fields.map(field => `"${field}" = ?`).join(', ');
    const values = [...fields.map(field => data[field]), id];

    return {
      sql: `UPDATE "${table}" SET ${setClause} WHERE "globalId" = ?`,
      params: values
    };
  }

  static createUpsertOperation(
    table: string,
    insertData: any,
    updateData: any,
    conflictField: string
  ): DynamicOperation {
    const insertFields = Object.keys(insertData);
    const insertPlace = insertFields.map(() => '?').join(', ');

    const updateFields = Object.keys(updateData).filter(field => field !== conflictField);
    const setUpdateClause = updateFields.map(field => `"${field}" = ?`).join(', ');

    let values = insertFields.map(field => insertData[field]);
    values.push(...updateFields.map(field => updateData[field]));

    return {
      sql: `INSERT INTO "${table}" (${insertFields.map(f => `"${f}"`).join(', ')})
            VALUES (${insertPlace})
            ON CONFLICT("${conflictField}")
            DO UPDATE SET ${setUpdateClause}`,
      params: values
    };
  }

  static createSelectOperation(
    table: string,
    where?: { field: string; operator: string; value: any } | { field: string; operator: string; value: any }[],
    orderBy?: { field: string; direction: 'ASC' | 'DESC' },
    limit?: number,
    offset?: number
  ): DynamicOperation {
    let sql = `SELECT * FROM "${table}"`;
    const params: any[] = [];

    if (where) {
      const conditions = Array.isArray(where) ? where : [where];

      if (conditions.length > 0) {
        const whereClauses: string[] = [];

        conditions.forEach(condition => {
          whereClauses.push(`"${condition.field}" ${condition.operator} ?`);
          params.push(condition.value);
        });

        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }
    }

    if (orderBy) {
      sql += ` ORDER BY "${orderBy.field}" ${orderBy.direction}`;
    }

    if (limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(limit);

      if (offset !== undefined) {
        sql += ` OFFSET ?`;
        params.push(offset);
      }
    }

    return { sql, params };
  }

  static createDeleteOperation(
    table: string,
    where?: { field: string; operator: string; value: any }
  ): DynamicOperation {
    if (where) {
      return {
        sql: `DELETE FROM "${table}" WHERE "${where.field}" ${where.operator} ?`,
        params: [where.value]
      };
    } else {
      throw new Error('Where condition required for delete operation');
    }
  }

  static createDeleteByIdOperation(table: string, id: number): DynamicOperation {
    return {
      sql: `DELETE FROM "${table}" WHERE "globalId" = ?`,
      params: [id]
    };
  }
}

// Utility function to check schema type without instanceof issues
const getSchemaTypeName = (schema: any): string => {
  return schema?.constructor?.name || 'Unknown';
};

const isZodObject = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodObject';
};

const isZodEffects = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodEffects';
};

const isZodOptional = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodOptional';
};

const isZodDefault = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodDefault';
};

const isZodNullable = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodNullable';
};

const isZodArray = (schema: any): boolean => {
  return getSchemaTypeName(schema) === 'ZodArray';
};

export class SchemaTypeChecker {
  static isNumberSchema = SchemaTypeChecker.createChecker('ZodNumber');
  static isDateSchema = SchemaTypeChecker.createChecker('ZodDate');
  static isBooleanSchema = SchemaTypeChecker.createChecker('ZodBoolean');
  static isStringSchema = SchemaTypeChecker.createChecker('ZodString');
  static isArraySchema = SchemaTypeChecker.createChecker('ZodArray');
  static isObjectSchema = SchemaTypeChecker.createChecker('ZodObject');
  static isRecordSchema = SchemaTypeChecker.createChecker('ZodRecord');
  static isEnumSchema = SchemaTypeChecker.createChecker('ZodEnum');
  static isNativeEnumSchema = SchemaTypeChecker.createChecker('ZodNativeEnum');
  static isUnionSchema = SchemaTypeChecker.createChecker('ZodUnion');
  static isIntersectionSchema = SchemaTypeChecker.createChecker('ZodIntersection');
  static isMapSchema = SchemaTypeChecker.createChecker('ZodMap');

  private static createChecker(typeName: string) {
    return (schema: z.ZodTypeAny): boolean => {
      if (getSchemaTypeName(schema) === typeName) return true;

      const innerSchema = this.getInnerSchema(schema);
      return innerSchema ? this.createChecker(typeName)(innerSchema) : false;
    };
  }

  private static getInnerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (isZodOptional(schema) ||
        isZodNullable(schema) ||
        isZodDefault(schema)) {
      return (schema as any)._def.innerType;
    }
    else if (isZodEffects(schema)) {
      return (schema as any)._def.schema || (schema as any)._def.innerType;
    }
    else if (getSchemaTypeName(schema) === 'ZodPipeline') {
      return (schema as any)._def.in;
    }
    return undefined;
  }
}

export class DynamicDataBuilder {
  static async buildData(
    data: any,
    schema: z.ZodSchema,
    options: TableOptions,
    context: {
      currentUserId?: string;
      organizationId?: string;
      operation?: 'create' | 'update';
      tableName?: string;
    } = {}
  ): Promise<any> {
    const preprocessedData = this.preprocessData(data, schema);
    let processedData: any = schema.parse(preprocessedData);

    if (options.autoFields) {
      const now = Date.now();

      if (options.autoFields.id && context.operation === 'create' && !processedData.globalId) {
        delete processedData.globalId; // Let D1 handle auto-increment
      }

      if (options.autoFields.timestamps) {
        if (context.operation === 'create') {
          processedData.created_at = now;
        }
        processedData.updated_at = now;
      }

      if (options.autoFields.user && context.currentUserId) {
        processedData.user_id = context.currentUserId;
      }

      if (options.autoFields.organization && context.organizationId) {
        processedData.organization_id = context.organizationId;
      }

    }

    processedData = this.transformData(processedData, schema);

    return processedData;
  }


  static transformData(data: any, schema: z.ZodSchema): any {
    const transformed = { ...data };
    const schemaShape = isZodObject(schema) ? (schema as any).shape : {};

    Object.keys(transformed).forEach(key => {
      const value = transformed[key];
      const fieldSchema = schemaShape[key];

      if (fieldSchema) {
        if (this.isJsonSerializableSchema(fieldSchema) && value !== null && value !== undefined) {
          if (typeof value === 'object' || Array.isArray(value)) {
            transformed[key] = JSON.stringify(value);
          }
        }
        if (SchemaTypeChecker.isBooleanSchema(fieldSchema) && typeof value === 'boolean') {
          transformed[key] = value ? 1 : 0;
        }

        if (SchemaTypeChecker.isDateSchema(fieldSchema) && value instanceof Date) {
          transformed[key] = value.getTime();
        }

        if (SchemaTypeChecker.isNumberSchema(fieldSchema) && typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
        }

        if (SchemaTypeChecker.isMapSchema(fieldSchema) && value instanceof Map) {
          const obj = Object.fromEntries(value);
          transformed[key] = JSON.stringify(obj);
        }
      }
    });

    return transformed;
  }

  static parseFromDatabase(data: any, schema: z.ZodSchema): any {
    if (!data) return data;

    const parsed = { ...data };

    Object.keys(parsed).forEach(key => {
      if (parsed[key] === null) {
        parsed[key] = undefined;
      }
    });

    const schemaShape = isZodObject(schema) ? (schema as any).shape : {};

    Object.keys(parsed).forEach(key => {
      const value = parsed[key];
      const fieldSchema = schemaShape[key];

      if (value === undefined || !fieldSchema) {
        return;
      }

      if (typeof value === 'string' && this.isJsonSerializableSchema(fieldSchema)) {
        try {
          const potentialJson = JSON.parse(value);
          if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
            if (SchemaTypeChecker.isMapSchema(fieldSchema)) {
              parsed[key] = new Map(Object.entries(potentialJson));
            } else {
              parsed[key] = potentialJson;
            }
          }
        } catch {
          // Not JSON
        }
      }

      if (SchemaTypeChecker.isBooleanSchema(fieldSchema)) {
        if (typeof value === 'number') {
          parsed[key] = value === 1;
        } else if (typeof value === 'string') {
          parsed[key] = value === '1';
        }
      }

      if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
        if (typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            parsed[key] = num;
          }
        }
      }

      if (SchemaTypeChecker.isDateSchema(fieldSchema)) {
        if (typeof value === 'number') {
          parsed[key] = new Date(value);
        } else if (typeof value === 'string') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            parsed[key] = date;
          }
        }
      }
    });

    return schema.parse(parsed);
  }

  private static isJsonSerializableSchema(schema: z.ZodTypeAny): boolean {
    return SchemaTypeChecker.isObjectSchema(schema) ||
           SchemaTypeChecker.isArraySchema(schema) ||
           SchemaTypeChecker.isRecordSchema(schema) ||
           SchemaTypeChecker.isMapSchema(schema);
  }

  static preprocessData(data: any, schema: z.ZodSchema): any {
    if (!data) return data;

    if (Array.isArray(data)) {
      return data.map(item => this.preprocessData(item, schema));
    }

    if (typeof data !== 'object') return data;

    const preprocessed = { ...data };
    const schemaShape = isZodObject(schema) ? (schema as any).shape : {};

    Object.keys(preprocessed).forEach(key => {
      const value = preprocessed[key];
      const fieldSchema = this.unwrapOptionalSchema(schemaShape[key]);

      if (fieldSchema && value !== null && value !== undefined) {
        if (typeof value === 'string' && this.isJsonSerializableSchema(fieldSchema)) {
          try {
            const potentialJson = JSON.parse(value);
            if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
              if (SchemaTypeChecker.isMapSchema(fieldSchema)) {
                preprocessed[key] = new Map(Object.entries(potentialJson));
              } else {
                preprocessed[key] = this.preprocessData(potentialJson, fieldSchema);
              }
            }
          } catch {
            // Not valid JSON
          }
        }

        if (typeof value === 'object' && this.isJsonSerializableSchema(fieldSchema)) {
          if (value instanceof Map) {
            const obj = Object.fromEntries(value);
            preprocessed[key] = this.preprocessData(obj, fieldSchema);
          } else if (Array.isArray(value)) {
            const elementSchema = this.getArrayElementSchema(fieldSchema);
            if (elementSchema) {
              preprocessed[key] = value.map(item =>
                typeof item === 'string' && this.isJsonSerializableSchema(elementSchema)
                  ? this.tryParseJson(item, elementSchema)
                  : this.preprocessData(item, elementSchema)
              );
            }
          } else if (value !== null) {
            preprocessed[key] = this.preprocessData(value, fieldSchema);
          }
        }

        if (SchemaTypeChecker.isBooleanSchema(fieldSchema)) {
          if (typeof value === 'number') {
            preprocessed[key] = value === 1;
          } else if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === '1' || lower === 'true') {
              preprocessed[key] = true;
            } else if (lower === '0' || lower === 'false') {
              preprocessed[key] = false;
            }
          }
        }

        if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
          if (typeof value === 'string') {
            const num = Number(value);
            if (!isNaN(num) && value.trim() !== '') {
              preprocessed[key] = num;
            }
          }
        }

        if (SchemaTypeChecker.isDateSchema(fieldSchema)) {
          if (typeof value === 'number') {
            preprocessed[key] = new Date(value);
          } else if (typeof value === 'string') {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              preprocessed[key] = date;
            }
          }
        }

        if (SchemaTypeChecker.isMapSchema(fieldSchema) && value instanceof Map) {
          preprocessed[key] = value;
        }
      }
    });

    return preprocessed;
  }

  private static unwrapOptionalSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
    if (!schema) return undefined;

    if (isZodOptional(schema) || isZodNullable(schema)) {
      return (schema as any)._def.innerType;
    }

    if (isZodDefault(schema)) {
      return (schema as any)._def.innerType;
    }

    return schema;
  }

  private static getArrayElementSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (isZodArray(schema)) {
      return (schema as any)._def.type;
    }

    const unwrapped = this.unwrapOptionalSchema(schema);
    if (isZodArray(unwrapped)) {
      return (unwrapped as any)._def.type;
    }

    return undefined;
  }

  private static tryParseJson(value: string, schema: z.ZodTypeAny): any {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) || typeof parsed === 'object') {
        if (SchemaTypeChecker.isMapSchema(schema)) {
          return new Map(Object.entries(parsed));
        }
        return this.preprocessData(parsed, schema);
      }
    } catch {
      // Not valid JSON
    }
    return value;
  }
}

export class D1DatabaseManager {
  private tableConfigs = new Map<string, TableConfig>();
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


  constructor(
    private db: D1Database,
  ) {
    this.initializeTables();
  }


  private async initializeTables(): Promise<void> {
		// Core tables
		this.registerTable('price_policies', PricePolicySchema, this.TABLE_CONFIGS.withUniqueIndex('code'));
		this.registerTable('services', ServiceSchema, this.TABLE_CONFIGS.withUniqueIndex('endpoint'));
		this.registerTable('vouchers', VoucherSchema, this.TABLE_CONFIGS.withUniqueIndex('code'));

		// User tables
		this.registerTable('users', UserSchema, this.TABLE_CONFIGS.withUniqueIndex('identifier'));
		this.registerTable('sessions', SessionSchema, this.TABLE_CONFIGS.withUniqueIndex('hashSessionId'));
		this.registerTable('connections', ConnectionSchema, this.TABLE_CONFIGS.withUniqueIndex('sessionId'));
		this.registerTable('subscriptions', SubscriptionSchema, this.TABLE_CONFIGS.withUniqueIndex('channel'));

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
			this.registerTable(name, schema, this.TABLE_CONFIGS.queueTable());
		});

		// Other tables
		this.registerTable('api_tokens', ApiTokenSchema, this.TABLE_CONFIGS.userScoped);
		this.registerTable('versions', VersionInfoSchema, this.TABLE_CONFIGS.userScoped);
		this.registerTable('pending_messages', PendingMessageSchema, this.TABLE_CONFIGS.userScoped);
  }

  registerTable(name: string, schema: z.ZodSchema, options: TableOptions = {}): void {
    this.tableConfigs.set(name, { schema, options });
    this.ensureTableExists(name, schema, options);
  }

  createExtendedSchema(
    baseSchema: z.ZodSchema,
    options: TableOptions
  ): z.ZodSchema {
    const baseShape = this.extractSchemaShape(baseSchema);
    const extensions: any = {};

    if (options.autoFields) {
      if (options.autoFields.id !== false) {
        // D1 sẽ tự động tăng GlobalID nếu column là INTEGER PRIMARY KEY
        extensions.globalId = z.number().optional();
        extensions.id = z.number().optional();
      }

      if (options.autoFields.timestamps !== false) {
        extensions.created_at = z.number().optional();
        extensions.updated_at = z.number().optional();
      }

      if (options.autoFields.user !== false) {
        extensions.user_id = z.string().optional();
      }

      if (options.autoFields.organization !== false) {
        extensions.organization_id = z.string().optional();
      }
      
      if (options.autoFields.queue !== false) {
        extensions.queueId = z.number().int().optional();
        extensions.queueStatus = z.enum(['pending', 'flushed', 'processed']).optional();
        extensions.flushedAt = z.number().optional();
        extensions.processedAt = z.number().optional();
      }
    }

    const extendedShape = { ...baseShape, ...extensions };
    return z.object(extendedShape);
  }


  // DYNAMIC OPERATIONS METHODS - ADAPTED FOR D1
  async dynamicInsert(tableName: string, data: any, userId?: string): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);
    
    
    const processedData = await DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
      currentUserId: userId,
      organizationId: undefined,
      operation: 'create',
      tableName
    });

    const operation = DynamicSchemaManager.createInsertOperation(tableName, processedData);
    const result = await this.execD1SQL(operation.sql, operation.params);
    if (!result.success){
      throw new Error(`Failed to insert record into ${tableName}`);
    }
    // Lấy ID vừa insert
    if (result.meta.last_row_id === undefined) {
      const lastIdResult = await this.db.prepare('SELECT last_insert_rowid() as id').first<{ id: number }>();
      if (lastIdResult) {
        processedData.globalId = lastIdResult.id;
      }
    }
    else processedData.globalId = result.meta.last_row_id;

    return processedData;
  }

  // Batch insert records from UserDO - preserves original values including id
  async batchInsertRecords(tableName: string, dataArray: any[]): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    
    for (const data of dataArray) {            
      // Create insert operation
      const operation = DynamicSchemaManager.createInsertOperation(tableName, data);
      statements.push(this.db.prepare(operation.sql).bind(...operation.params));
    }
    
    // Execute batch insert
    const batchResults = await this.db.batch(statements);
    let isError: boolean = false
    for (const result of batchResults) {
      if (!result.success){
        console.error(`Failed to batch insert records into ${result.error}`);
        isError = true;
      }
    }
    if (isError){
      throw new Error(`Failed to batch insert records into ${tableName}`);
    }    
  }

  async dynamicUpdate(tableName: string, id: number, data: any, userId?: string): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const existingData = await this.dynamicSelect(tableName, { field: 'id', operator: '=', value: Number(id) });
    if (existingData.length === 0) {
      throw new Error(`No record found with id: ${id}`);
    }

    const updateData = { ...existingData[0], ...data };
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const processedData = await DynamicDataBuilder.buildData(updateData, extendedSchema, config.options, {
      currentUserId: userId,
      organizationId: undefined,
      operation: 'update',
      tableName
    });

    const operation = DynamicSchemaManager.createUpdateOperation(
      tableName,
      id,
      processedData
    );

    const result = await this.execD1SQL(operation.sql, operation.params);
    if (!result.success){
      throw new Error(`Failed to update record in ${tableName}`);
    }

    return processedData;
  }

  async dynamicUpsert(tableName: string, data: any, userId?: string, conflictField?: string): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const conflictFieldToUse = conflictField || config.options.conflictField;
    if (!conflictFieldToUse) {
      throw new Error(`No conflict field defined for table: ${tableName}`);
    }

    const extendedSchema = this.createExtendedSchema(config.schema, config.options);
    const processedData = await DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
      currentUserId: userId,
      organizationId: undefined,
      operation: 'create',
      tableName
    });

    const updateData = DynamicDataBuilder.transformData(DynamicDataBuilder.preprocessData(data, config.schema), config.schema);
    const operation = DynamicSchemaManager.createUpsertOperation(
      tableName,
      processedData,
      updateData,
      conflictFieldToUse
    );

    const result = await this.execD1SQL(operation.sql, operation.params);
    if (!result.success){
      throw new Error(`Failed to upsert record in ${tableName}`);
    }

    if (result.meta.last_row_id === undefined) {
      const lastIdResult = await this.db.prepare('SELECT last_insert_rowid() as id').first<{ id: number }>();
      if (lastIdResult) {
        processedData.globalId = lastIdResult.id;
      }
    }
    else processedData.globalId = result.meta.last_row_id;

    return processedData;
  }

  async dynamicDelete(tableName: string, id: number): Promise<void> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operation = DynamicSchemaManager.createDeleteByIdOperation(tableName, id);
    const result = await this.execD1SQL(operation.sql, operation.params);
    if (!result.success){
      throw new Error(`Failed to delete record in ${tableName}`);
    }
  }

  async dynamicDeleteWhere(
    tableName: string,
    where: { field: string; operator: string; value: any }
  ): Promise<void> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operation = DynamicSchemaManager.createDeleteOperation(tableName, where);
    const result = await this.execD1SQL(operation.sql, operation.params);
    if (!result.success){
      throw new Error(`Failed to delete record in ${tableName}`);
    }
  }

  async dynamicSelect(
    tableName: string,
    where?: { field: string; operator: string; value: any } | { field: string; operator: string; value: any }[],
    orderBy?: { field: string; direction: 'ASC' | 'DESC' },
    limit?: number,
    offset?: number
  ): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const operation = DynamicSchemaManager.createSelectOperation(
      tableName,
      where,
      orderBy,
      limit,
      offset
    );

    const result = await this.db.prepare(operation.sql).bind(...operation.params).all();

    if (!result.results) {
      return [];
    }

    return result.results.map(row =>
      DynamicDataBuilder.parseFromDatabase(row, extendedSchema)
    );
  }

  async dynamicBatchInsert(tableName: string, dataArray: any[], userId?: string): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const statements: D1PreparedStatement[] = [];
    const results: any[] = [];

    for (const data of dataArray) {
      const processedData = await DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
        currentUserId: userId,
        organizationId: undefined,
        operation: 'create',
        tableName
      });

      const operation = DynamicSchemaManager.createInsertOperation(
        tableName,
        processedData
      );

      statements.push(this.db.prepare(operation.sql).bind(...operation.params));
      results.push(processedData);
    }

    const batchResults = await this.db.batch(statements);
    let isError: boolean = false
    for (const result of batchResults) {
      if (!result.success){
        console.error(`Failed to batch insert records into ${result.error}`);
        isError = true;
      }
    }
    if (isError){
      throw new Error(`Failed to batch insert records into ${tableName}`);
    }
    return results;
  }

  async dynamicMultiTableTransaction(operations: Array<{
    table?: string;
    operation: 'insert' | 'update' | 'upsert' | 'delete' | 'sql';
    data?: any;
    id?: number;
    conflictField?: string;
    where?: { field: string; operator: string; value: any };
  }>, userId?: string): Promise<any[]> {
    const statements: D1PreparedStatement[] = [];
    const results: any[] = [];

    for (const op of operations) {
      let config: TableConfig | undefined;
      let extendedSchema: any;

      switch (op.operation) {
        case 'insert':
          if (!op.data || !op.table) {
            throw new Error('Table and data required for insert operation');
          }

          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }

          extendedSchema = this.createExtendedSchema(config.schema, config.options);
          const insertData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: userId,
            organizationId: undefined,
            operation: 'create',
            tableName: op.table
          });

          const insertOp = DynamicSchemaManager.createInsertOperation(op.table, insertData);
          statements.push(this.db.prepare(insertOp.sql).bind(...insertOp.params));
          results.push(insertData);
          break;

        case 'update':
          if (!op.id || !op.data || !op.table) {
            throw new Error('Table, ID and data required for update operation');
          }

          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }

          extendedSchema = this.createExtendedSchema(config.schema, config.options);
          const updateData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: userId,
            organizationId: undefined,
            operation: 'update',
            tableName: op.table
          });

          const updateOp = DynamicSchemaManager.createUpdateOperation(op.table, op.id, updateData);
          statements.push(this.db.prepare(updateOp.sql).bind(...updateOp.params));
          results.push(updateData);
          break;

        case 'upsert':
          if (!op.data || !op.table) {
            throw new Error('Table and data required for upsert operation');
          }

          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }

          extendedSchema = this.createExtendedSchema(config.schema, config.options);
          const upsertData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: userId,
            organizationId: undefined,
            operation: 'create',            
            tableName: op.table
          });

          const conflictField = op.conflictField || config.options.conflictField;
          if (!conflictField) {
            throw new Error('Conflict field required for upsert operation');
          }

          const updateDataForUpsert = DynamicDataBuilder.transformData(
            DynamicDataBuilder.preprocessData(op.data, config.schema),
            config.schema
          );

          const upsertOp = DynamicSchemaManager.createUpsertOperation(
            op.table,
            upsertData,
            updateDataForUpsert,
            conflictField
          );

          statements.push(this.db.prepare(upsertOp.sql).bind(...upsertOp.params));
          results.push(upsertData);
          break;

        case 'delete':
          if (!op.table) {
            throw new Error('Table required for delete operation');
          }

          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }

          if (op.id) {
            const deleteOp = DynamicSchemaManager.createDeleteByIdOperation(op.table, op.id);
            statements.push(this.db.prepare(deleteOp.sql).bind(...deleteOp.params));
            results.push({ id: op.id, deleted: true });
          } else if (op.where) {
            const deleteOp = DynamicSchemaManager.createDeleteOperation(op.table, op.where);
            statements.push(this.db.prepare(deleteOp.sql).bind(...deleteOp.params));
            results.push({ where: op.where, deleted: true });
          } else {
            throw new Error('ID or where condition required for delete operation');
          }
          break;

        case 'sql':
          if (!op.data) {
            throw new Error('SQL operation data required');
          }
          for (const itemOp of op.data) {
            statements.push(this.db.prepare(itemOp.sql).bind(...itemOp.params));
          }
          break;

        default:
          throw new Error(`Unknown operation: ${op.operation}`);
      }
    }

    const batchResults = await this.db.batch(statements);
    let isError: boolean = false
    for (const result of batchResults) {
      if (!result.success){
        console.error(`Failed to batch execute SQL: ${result.error}`);
        isError = true;
      }
    }
    if (isError){
      throw new Error(`Failed to batch execute SQL`);
    }
    return batchResults;
  }

  // D1-SPECIFIC METHODS
  private async execD1SQL(sql: string, params: any[] = []): Promise<D1Result> {
    try {
      return await this.db.prepare(sql).bind(...params).run();
    } catch (error) {
      console.error(`Error executing SQL: ${sql}`, error);
      throw error;
    }
  }

  async rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const result = await this.db.prepare(sql).bind(...params).all<T>();
      return result.results || [];
    } catch (error) {
      console.error(`Error in rawQuery: ${sql}`, error);
      throw error;
    }
  }

  // TABLE MANAGEMENT
  private async ensureTableExists(name: string, schema: z.ZodSchema, options: TableOptions): Promise<void> {
    const schemaShape = this.extractSchemaShape(schema);
    const columns = this.buildColumnDefinitions(schemaShape, options);

    const createSQL = `CREATE TABLE IF NOT EXISTS "${name}" (
      ${columns.join(',\n      ')}
    )`;

    try {
      // Use prepare().run() for single DDL statements in D1
      await this.db.prepare(createSQL).run();
    } catch (err) {
      console.error(`Error creating table ${name} with sql: ${createSQL}`, err);
      throw err;
    }

    await this.createIndexes(name, options);
  }

  private extractSchemaShape(schema: z.ZodSchema): Record<string, z.ZodTypeAny> {
    const typeName = getSchemaTypeName(schema);
    
    // Base case: ZodObject
    if (typeName === 'ZodObject') {
      return (schema as any).shape;
    }
    
    // ZodEffects từ .refine(), .transform(), preprocess, etc.
    if (typeName === 'ZodEffects') {
      const def = (schema as any)._def;
      const innerSchema = def.schema || def.innerType;
      if (innerSchema) {
        return this.extractSchemaShape(innerSchema);
      }
      return {};
    }
    
    // ZodOptional, ZodDefault, ZodNullable
    if (typeName === 'ZodOptional' || 
        typeName === 'ZodDefault' || 
        typeName === 'ZodNullable') {
      return this.extractSchemaShape((schema as any)._def.innerType);
    }
    
    // ZodArray
    if (typeName === 'ZodArray') {
      // Mảng được lưu dưới dạng JSON string
      return {};
    }
    
    // ZodRecord - được lưu dưới dạng JSON string
    if (typeName === 'ZodRecord') {
      return {};
    }
    
    // ZodMap - được lưu dưới dạng JSON string
    if (typeName === 'ZodMap') {
      return {};
    }
    
    // ZodTuple - được lưu dưới dạng JSON string
    if (typeName === 'ZodTuple') {
      return {};
    }
    
    // ZodLazy
    if (typeName === 'ZodLazy') {
      try {
        return this.extractSchemaShape((schema as any)._def.getter());
      } catch {
        return {};
      }
    }
    
    // ZodUnion - try to extract shape from all options
    if (typeName === 'ZodUnion') {
      const options = (schema as any)._def.options as z.ZodTypeAny[];
      const allShapes = options.map(opt => this.extractSchemaShape(opt));
      // Merge all shapes
      const merged: Record<string, z.ZodTypeAny> = {};
      allShapes.forEach(shape => {
        Object.assign(merged, shape);
      });
      return merged;
    }
    
    // ZodIntersection
    if (typeName === 'ZodIntersection') {
      const leftShape = this.extractSchemaShape((schema as any)._def.left);
      const rightShape = this.extractSchemaShape((schema as any)._def.right);
      return { ...leftShape, ...rightShape };
    }
    
    return {};
  }

  private buildColumnDefinitions(schemaShape: any, options: TableOptions): string[] {
    const columns: string[] = [];

    // Add auto fields based on configuration
    if (options.autoFields?.id !== false) {
      // D1 uses AUTOINCREMENT for auto-incrementing IDs
      columns.push('"globalId" INTEGER PRIMARY KEY AUTOINCREMENT');
      columns.push('"id" INTEGER');
    }

    if (options.autoFields?.timestamps !== false) {
      columns.push('"created_at" INTEGER NOT NULL');
      columns.push('"updated_at" INTEGER NOT NULL');
    }

    if (options.autoFields?.user !== false) {
      if (options.userScoped) {
        columns.push('"user_id" TEXT NOT NULL');
      } else {
        columns.push('"user_id" TEXT');
      }
    }

    if (options.autoFields?.organization !== false) {
      if (options.organizationScoped) {
        columns.push('"organization_id" TEXT NOT NULL');
      } else {
        columns.push('"organization_id" TEXT');
      }
    }
    
    if (options.autoFields?.queue !== false) {
      columns.push('"queueId" INTEGER');
      columns.push('"queueStatus" TEXT');
      columns.push('"flushedAt" INTEGER');
      columns.push('"processedAt" INTEGER');
    }

    // Add columns from schema
    for (const [key, value] of Object.entries(schemaShape)) {
      const columnType = this.getColumnType(value as z.ZodTypeAny);
      columns.push(`"${key}" ${columnType}`);
    }

    // Add UNIQUE constraints for conflictField
    if (options.conflictField) {
      columns.push(`UNIQUE("${options.conflictField}")`);
    }

    return columns;
  }

  private getColumnType(zodType: z.ZodTypeAny): string {
    const unwrappedType = this.unwrapZodType(zodType);
    const typeName = getSchemaTypeName(unwrappedType);

    // Map to SQLite types (D1 uses SQLite)
    if (typeName === 'ZodString') {
      return 'TEXT';
    } else if (typeName === 'ZodNumber') {
      return this.isIntegerType(unwrappedType as z.ZodNumber) ? 'INTEGER' : 'REAL';
    } else if (typeName === 'ZodBoolean') {
      return 'INTEGER';
    } else if (typeName === 'ZodDate') {
      return 'INTEGER';
    } else if (typeName === 'ZodBigInt') {
      return 'TEXT';
    } else if (typeName === 'ZodEnum') {
      return 'TEXT';
    } else if (typeName === 'ZodNativeEnum') {
      return 'TEXT';
    } else if (typeName === 'ZodLiteral') {
      const value = (unwrappedType as any)._def.value;
      if (typeof value === 'boolean') {
        return 'INTEGER';
      } else if (typeof value === 'number') {
        return Number.isInteger(value) ? 'INTEGER' : 'REAL';
      } else {
        return 'TEXT';
      }
    } else if (typeName === 'ZodRecord' ||
               typeName === 'ZodMap' ||
               typeName === 'ZodArray' ||
               typeName === 'ZodTuple' ||
               typeName === 'ZodObject') {
      return 'TEXT';
    } else {
      return 'TEXT';
    }
  }

  private unwrapZodType(zodType: z.ZodTypeAny): z.ZodTypeAny {
    const typeName = getSchemaTypeName(zodType);
    const def = (zodType as any)._def;

    if (typeName === 'ZodEffects') {
      if (def.schema) {
        return this.unwrapZodType(def.schema);
      }
      if (def.innerType) {
        return this.unwrapZodType(def.innerType);
      }
    }

    if (typeName === 'ZodOptional' ||
        typeName === 'ZodNullable' ||
        typeName === 'ZodDefault' ||
        typeName === 'ZodBranded' ||
        typeName === 'ZodReadonly' ||
        typeName === 'ZodCatch' ||
        typeName === 'ZodPromise') {

      if (def.innerType) {
        return this.unwrapZodType(def.innerType);
      }
      if (def.valueType) {
        return this.unwrapZodType(def.valueType);
      }
      if (def.type) {
        return this.unwrapZodType(def.type);
      }
    }

    if (typeName === 'ZodLazy' && def.getter) {
      try {
        return this.unwrapZodType(def.getter());
      } catch {
        return z.string();
      }
    }

    if (typeName === 'ZodPipeline' && def.in) {
      return this.unwrapZodType(def.in);
    }

    if (typeName === 'ZodUnion') {
      const options = def.options as z.ZodTypeAny[];
      const unwrappedTypes = options.map(opt => this.unwrapZodType(opt));

      const booleanType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodBoolean');
      if (booleanType) return booleanType;

      const numberType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodNumber');
      if (numberType) return numberType;

      const stringType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodString');
      if (stringType) return stringType;

      const recordType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodRecord');
      if (recordType) return recordType;

      const arrayType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodArray');
      if (arrayType) return arrayType;

      const objectType = unwrappedTypes.find(t => getSchemaTypeName(t) === 'ZodObject');
      if (objectType) return objectType;

      return unwrappedTypes[0] || z.string();
    }

    if (typeName === 'ZodIntersection') {
      const left = this.unwrapZodType(def.left);
      const right = this.unwrapZodType(def.right);

      if (getSchemaTypeName(left) === 'ZodBoolean' || getSchemaTypeName(right) === 'ZodBoolean') {
        return z.boolean();
      }
      if (getSchemaTypeName(left) === 'ZodNumber' || getSchemaTypeName(right) === 'ZodNumber') {
        return z.number();
      }
      if (getSchemaTypeName(left) === 'ZodString' || getSchemaTypeName(right) === 'ZodString') {
        return z.string();
      }
      if (getSchemaTypeName(left) === 'ZodRecord' || getSchemaTypeName(right) === 'ZodRecord') {
        return z.record(z.string(), z.any());
      }
      if (getSchemaTypeName(left) === 'ZodArray' || getSchemaTypeName(right) === 'ZodArray') {
        return z.array(z.any());
      }
      if (getSchemaTypeName(left) === 'ZodObject' || getSchemaTypeName(right) === 'ZodObject') {
        return z.object({});
      }

      return left;
    }

    if (typeName === 'ZodDiscriminatedUnion') {
      const allTypes: z.ZodTypeAny[] = [];
      for (const options of def.options.values()) {
        options.forEach((opt: z.ZodTypeAny) =>
          allTypes.push(this.unwrapZodType(opt))
        );
      }

      const booleanType = allTypes.find(t => getSchemaTypeName(t) === 'ZodBoolean');
      if (booleanType) return booleanType;

      const numberType = allTypes.find(t => getSchemaTypeName(t) === 'ZodNumber');
      if (numberType) return numberType;

      const stringType = allTypes.find(t => getSchemaTypeName(t) === 'ZodString');
      if (stringType) return stringType;

      const recordType = allTypes.find(t => getSchemaTypeName(t) === 'ZodRecord');
      if (recordType) return recordType;

      const arrayType = allTypes.find(t => getSchemaTypeName(t) === 'ZodArray');
      if (arrayType) return arrayType;

      const objectType = allTypes.find(t => getSchemaTypeName(t) === 'ZodObject');
      if (objectType) return objectType;

      return allTypes[0] || z.string();
    }

    return zodType;
  }

  private isIntegerType(zodNumber: z.ZodNumber): boolean {
    const checks = (zodNumber as any)._def.checks || [];
    return checks.some((check: any) => check.kind === 'int');
  }

  private async createIndexes(tableName: string, options: TableOptions): Promise<void> {
    // Create regular indexes
    for (const index of options.indexes || []) {
      const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${index}" ON "${tableName}" ("${index}")`;
      try {
        await this.db.prepare(indexSQL).run();
      }
      catch (e) {
        console.error(`Error creating index for ${tableName}:`, e);
        throw e;
      }
    }

    // Create unique indexes
    for (const uniqueIndex of options.uniqueIndexes || []) {
      const uniqueIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_${uniqueIndex}" ON "${tableName}" ("${uniqueIndex}")`;
      try {
        await this.db.prepare(uniqueIndexSQL).run();
      }
      catch (e) {
        console.error(`Error creating unique index for ${tableName}:`, e);
        throw e;
      }
    }

    // Create composite unique indexes for user/organization scoped tables
    if (options.userScoped && options.organizationScoped) {
      const compositeUniqueSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_user_org" ON "${tableName}" ("user_id", "organization_id")`;
      try {
        await this.db.prepare(compositeUniqueSQL).run();
      }
      catch (e) {
        console.error(`Error creating composite index for ${tableName}:`, e);
        throw e;
      }
    }
  }

  // D1 TRANSACTION HANDLING
  async execTransaction(operations: Array<{ sql: string; params?: any[] }>): Promise<void> {
    if (!operations.length) {
      throw new Error('Empty transaction');
    }

    const statements: D1PreparedStatement[] = operations.map(op =>
      this.db.prepare(op.sql).bind(...(op.params || []))
    );

    try {
      await this.db.batch(statements);
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }

  async execSelectSQL(sql: string, params: any[] = [], table?: string): Promise<any[]> {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT statements are allowed in execSelectSQL');
    }

    try {
      const result = await this.db.prepare(sql).bind(...params).all();

      if (table && table !== '') {
        const config = this.tableConfigs.get(table);
        if (!config) {
          throw new Error(`Table ${table} not registered`);
        }

        return (result.results || []).map(row =>
          DynamicDataBuilder.parseFromDatabase(row, config.schema)
        );
      }

      return result.results || [];
    } catch (error) {
      console.error(`Error executing SQL: ${sql}`, error);
      throw error;
    }
  }

  // UTILITY METHODS
  async getTableInfo(tableName: string): Promise<any> {
    const result = await this.db.prepare(`
      SELECT * FROM pragma_table_info(?)
    `).bind(tableName).all();

    return result.results || [];
  }

  async getTableRowCount(tableName: string): Promise<number> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count FROM "${tableName}"
    `).first<{ count: number }>();

    return result?.count || 0;
  }

  async vacuum(): Promise<void> {
    await this.db.prepare('VACUUM').run();
  }

  async exportSchema(): Promise<string> {
    const tables = Array.from(this.tableConfigs.keys());
    const schemaStatements: string[] = [];

    for (const tableName of tables) {
      const tableInfo = await this.getTableInfo(tableName);
      const config = this.tableConfigs.get(tableName);

      if (config && tableInfo.length > 0) {
        const columns = tableInfo.map((col: any) => {
          let colDef = `"${col.name}" ${col.type}`;
          if (col.pk) colDef += ' PRIMARY KEY';
          if (col.notnull) colDef += ' NOT NULL';
          if (col.dflt_value !== null) colDef += ` DEFAULT ${col.dflt_value}`;
          return colDef;
        }).join(',\n  ');

        schemaStatements.push(`CREATE TABLE "${tableName}" (\n  ${columns}\n);`);
      }
    }

    return schemaStatements.join('\n\n');
  }
}