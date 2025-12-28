import { z } from 'zod';
import { GenericTable } from './table.js';

export interface TableOptions {
  userScoped?: boolean;
  organizationScoped?: boolean;
  indexes?: string[];
  uniqueIndexes?: string[]; // Thêm unique indexes
  autoFields?: {
    id?: boolean;
    timestamps?: boolean;
    user?: boolean;
    organization?: boolean;
    queue?: boolean; // Thêm hỗ trợ queue
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
      sql: `UPDATE "${table}" SET ${setClause} WHERE "id" = ?`,
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
    
    // Sử dụng excluded values cho UPDATE
    const updateFields = Object.keys(updateData).filter(field => field !== conflictField);
    const setUpdateClause = updateFields.map(field => `"${field}" = ?`).join(', ');
    
    // Tạo values cho INSERT, UPDATE
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

    // Xử lý where clause
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

    // Xử lý order by
    if (orderBy) {
      sql += ` ORDER BY "${orderBy.field}" ${orderBy.direction}`;
    }

    // Xử lý limit và offset
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
      sql: `DELETE FROM "${table}" WHERE "id" = ?`,
      params: [id]
    };
  }
}

export class SchemaTypeChecker {
  // Factory method tạo các checker cụ thể
  static isNumberSchema = SchemaTypeChecker.createChecker(z.ZodNumber);
  static isDateSchema = SchemaTypeChecker.createChecker(z.ZodDate);
  static isBooleanSchema = SchemaTypeChecker.createChecker(z.ZodBoolean);
  static isStringSchema = SchemaTypeChecker.createChecker(z.ZodString);  
  static isArraySchema = SchemaTypeChecker.createChecker(z.ZodArray);
  static isObjectSchema = SchemaTypeChecker.createChecker(z.ZodObject);
  static isRecordSchema = SchemaTypeChecker.createChecker(z.ZodRecord); // Thêm cho ZodRecord
  static isEnumSchema = SchemaTypeChecker.createChecker(z.ZodEnum);
  static isNativeEnumSchema = SchemaTypeChecker.createChecker(z.ZodNativeEnum);
  static isUnionSchema = SchemaTypeChecker.createChecker(z.ZodUnion);
  static isIntersectionSchema = SchemaTypeChecker.createChecker(z.ZodIntersection);
  static isMapSchema = SchemaTypeChecker.createChecker(z.ZodMap); // Thêm cho ZodMap
  
  private static createChecker<T extends z.ZodTypeAny>(targetType: abstract new (...args: any[]) => T) {
    return (schema: z.ZodTypeAny): boolean => {
      if (schema instanceof targetType) return true;
      
      const innerSchema = this.getInnerSchema(schema);
      return innerSchema ? this.createChecker(targetType)(innerSchema) : false;
    };
  }
  
  private static getInnerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (schema instanceof z.ZodOptional || 
        schema instanceof z.ZodNullable || 
        schema instanceof z.ZodDefault) {
      return schema._def.innerType;
    } 
    else if (schema instanceof z.ZodEffects) {
      return schema._def.schema;
    }
    else if (schema instanceof z.ZodPipeline) {
      return schema._def.in;
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
      getNextId?: (tableName: string) => Promise<number>;
      tableName?: string;
    } = {}
  ): Promise<any> {
    const preprocessedData = this.preprocessData(data, schema);
    let processedData = schema.parse(preprocessedData);

    // Auto-generate fields based on configuration
    if (options.autoFields) {
      const now = Date.now();

      if (options.autoFields.id && context.operation === 'create' && !processedData.id) {
        if (context.getNextId) {
          // Lấy ID tự tăng từ storage
          processedData.id = await context.getNextId(context.tableName || '');
        } else {
          throw new Error('getNextId function is required for auto-increment IDs');
        }
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

      // Kiểm tra và xử lý queue logic
      if (options.autoFields.queue && context.getNextId && context.tableName) {
        await this.handleQueueLogic(processedData, context);
      }
    }

    // Transform data types for SQL storage
    processedData = this.transformData(processedData, schema);

    return processedData;
  }

  /**
   * Xử lý logic queue: nếu queueStatus = 'pending' thì tạo queueId
   */
  private static async handleQueueLogic(
    data: any,
    context: {
      getNextId?: (tableName: string) => Promise<number>;
      tableName?: string;
    }
  ): Promise<void> {
    // Kiểm tra nếu có trường queueStatus và giá trị là 'pending'
    if (data.queueStatus === 'pending' && context.getNextId && context.tableName) {
      // Tạo queueId mới
      data.queueId = await context.getNextId(`${context.tableName}_queue`);
    }
  }

  static transformData(data: any, schema: z.ZodSchema): any {
    const transformed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(transformed).forEach(key => {
      const value = transformed[key];
      const fieldSchema = schemaShape[key];

      if (fieldSchema) {
        // Auto JSON stringify cho record/object/array/map fields
        if (this.isJsonSerializableSchema(fieldSchema) && value !== null && value !== undefined) {
          if (typeof value === 'object' || Array.isArray(value)) {
            transformed[key] = JSON.stringify(value);
          }
        }        
        // Convert boolean to integer for SQLite (nhất quán với parseFromDatabase)
        if (SchemaTypeChecker.isBooleanSchema(fieldSchema) && typeof value === 'boolean') {
          transformed[key] = value ? 1 : 0;
        }
        
        // Convert Date to timestamp
        if (SchemaTypeChecker.isDateSchema(fieldSchema) && value instanceof Date) {
          transformed[key] = value.getTime();
        }

        // Đảm bảo number được lưu đúng
        if (SchemaTypeChecker.isNumberSchema(fieldSchema) && typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
        }

        // Xử lý Map - chuyển thành object trước khi stringify
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
    
    // Bước 1: Pre-process - chuyển tất cả null thành undefined
    Object.keys(parsed).forEach(key => {
      if (parsed[key] === null) {
        parsed[key] = undefined;
      }
    });

    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    // Bước 2: Type conversion
    Object.keys(parsed).forEach(key => {
      const value = parsed[key];
      const fieldSchema = schemaShape[key];

      // Bỏ qua nếu undefined (đã xử lý ở trên)
      if (value === undefined || !fieldSchema) {
        return;
      }

      // Xử lý object/array/record/map từ JSON string
      if (typeof value === 'string' && this.isJsonSerializableSchema(fieldSchema)) {
        try {
          const potentialJson = JSON.parse(value);
          if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
            // Xử lý đặc biệt cho Map
            if (SchemaTypeChecker.isMapSchema(fieldSchema)) {
              parsed[key] = new Map(Object.entries(potentialJson));
            } else {
              parsed[key] = potentialJson;
            }
          }
        } catch {
          // Not JSON, giữ nguyên string
        }
      }
      
      // Xử lý boolean
      if (SchemaTypeChecker.isBooleanSchema(fieldSchema)) {
        if (typeof value === 'number') {
          parsed[key] = value === 1;
        } else if (typeof value === 'string') {
          parsed[key] = value === '1';
        }
      }
      
      // Xử lý number
      if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
        if (typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            parsed[key] = num;
          }
        }
      }
      
      // Xử lý date
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

  // Helper methods
  private static isJsonSerializableSchema(schema: z.ZodTypeAny): boolean {
    // Kiểm tra nếu schema là object, array, record, map (có thể chứa JSON)
    return SchemaTypeChecker.isObjectSchema(schema) || 
           SchemaTypeChecker.isArraySchema(schema) ||
           SchemaTypeChecker.isRecordSchema(schema) ||
           SchemaTypeChecker.isMapSchema(schema);
  }

  /**
   * Preprocess data to parse JSON strings and convert types before validation
   * Handles: JSON strings, nested objects/arrays/records/maps, boolean/number/date conversions
   */
  static preprocessData(data: any, schema: z.ZodSchema): any {
    if (!data) return data;
    
    // Handle arrays - preprocess each element
    if (Array.isArray(data)) {
      return data.map(item => this.preprocessData(item, schema));
    }
    
    // Handle non-object types
    if (typeof data !== 'object') return data;

    const preprocessed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(preprocessed).forEach(key => {
      const value = preprocessed[key];
      const fieldSchema = this.unwrapOptionalSchema(schemaShape[key]);

      if (fieldSchema && value !== null && value !== undefined) {
        // 1. Parse JSON strings for object/array/record/map fields
        if (typeof value === 'string' && this.isJsonSerializableSchema(fieldSchema)) {
          try {
            const potentialJson = JSON.parse(value);
            // Only parse if result is object or array
            if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
              // Xử lý đặc biệt cho Map
              if (SchemaTypeChecker.isMapSchema(fieldSchema)) {
                preprocessed[key] = new Map(Object.entries(potentialJson));
              } else {
                preprocessed[key] = this.preprocessData(potentialJson, fieldSchema);
              }
            }
          } catch {
            // Not valid JSON, keep as string
          }
        }
        
        // 2. Handle nested objects/arrays/records - recursively preprocess
        if (typeof value === 'object' && this.isJsonSerializableSchema(fieldSchema)) {
          if (value instanceof Map) {
            // Map - chuyển thành object để xử lý
            const obj = Object.fromEntries(value);
            preprocessed[key] = this.preprocessData(obj, fieldSchema);
          } else if (Array.isArray(value)) {
            // Array of items - preprocess each item if schema has element type
            const elementSchema = this.getArrayElementSchema(fieldSchema);
            if (elementSchema) {
              preprocessed[key] = value.map(item => 
                typeof item === 'string' && this.isJsonSerializableSchema(elementSchema)
                  ? this.tryParseJson(item, elementSchema)
                  : this.preprocessData(item, elementSchema)
              );
            }
          } else if (value !== null) {
            // Nested object/record - recursively preprocess
            preprocessed[key] = this.preprocessData(value, fieldSchema);
          }
        }
        
        // 3. Convert boolean from number/string (1/0, '1'/'0', 'true'/'false')
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
        
        // 4. Convert number from string
        if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
          if (typeof value === 'string') {
            const num = Number(value);
            if (!isNaN(num) && value.trim() !== '') {
              preprocessed[key] = num;
            }
          }
        }
        
        // 5. Convert date from string/timestamp
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

        // 6. Xử lý Map đặc biệt
        if (SchemaTypeChecker.isMapSchema(fieldSchema) && value instanceof Map) {
          // Map đã được xử lý ở trên, chỉ cần đảm bảo nó được giữ nguyên
          preprocessed[key] = value;
        }
      }
    });

    return preprocessed;
  }

  /**
   * Unwrap optional schema to get the inner type
   */
  private static unwrapOptionalSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
    if (!schema) return undefined;
    
    // Handle ZodOptional
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return schema._def.innerType;
    }
    
    // Handle ZodDefault
    if (schema instanceof z.ZodDefault) {
      return schema._def.innerType;
    }
    
    return schema;
  }

  /**
   * Get element schema from array schema
   */
  private static getArrayElementSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (schema instanceof z.ZodArray) {
      return schema._def.type;
    }
    
    // Handle optional/nullable arrays
    const unwrapped = this.unwrapOptionalSchema(schema);
    if (unwrapped instanceof z.ZodArray) {
      return unwrapped._def.type;
    }
    
    return undefined;
  }

  /**
   * Try to parse JSON string and preprocess if successful
   */
  private static tryParseJson(value: string, schema: z.ZodTypeAny): any {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) || typeof parsed === 'object') {
        // Xử lý đặc biệt cho Map
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

export class UserDODatabase {  
  private tables = new Map<string, GenericTable<any>>();
  private tableConfigs = new Map<string, TableConfig>();
  private organizationContext?: string;
  private idCounters = new Map<string, number>();

  constructor(
    private storage: DurableObjectStorage,
    private currentUserId: string,
    private broadcast?: (event: string, data: any) => void
  ) { 
    // Khởi tạo ID counters từ storage
    this.initializeIdCounters();
  }

  private async initializeIdCounters(): Promise<void> {
    try {
      const counters = await this.storage.get<Record<string, number>>('_id_counters');
      if (counters) {
        for (const [tableName, counter] of Object.entries(counters)) {
          this.idCounters.set(tableName, counter);
        }
      }
    } catch (error) {
      console.error('Failed to initialize ID counters:', error);
    }
  }

  private async saveIdCounters(): Promise<void> {
    const counters: Record<string, number> = {};
    this.idCounters.forEach((value, key) => {
      counters[key] = value;
    });
    await this.storage.put('_id_counters', counters);
  }

  private async getNextId(tableName: string): Promise<number> {
    // Lấy counter hiện tại hoặc khởi tạo bằng 1
    let currentCounter = this.idCounters.get(tableName) || 0;
    
    // Tăng counter lên 1
    currentCounter++;
    
    // Lưu counter mới
    this.idCounters.set(tableName, currentCounter);
    await this.saveIdCounters();
    
    return currentCounter;
  }

  setOrganizationContext(organizationId?: string): void {
    this.organizationContext = organizationId;
  }

  registerTable(name: string, schema: z.ZodSchema, options: TableOptions = {}): void {
    this.tableConfigs.set(name, { schema, options });
    this.ensureTableExists(name, schema, options);
  }

  createExtendedSchema(
    baseSchema: z.ZodSchema, 
    options: TableOptions
  ): z.ZodSchema {
    let extendedSchema = baseSchema;

    // Thêm auto fields vào schema
    if (options.autoFields) {
      const extensions: any = {};

      if (options.autoFields.id) {
        // ID giờ là số tự tăng
        extensions.id = z.number().optional();
      }

      if (options.autoFields.timestamps) {
        extensions.created_at = z.number().optional();
        extensions.updated_at = z.number().optional();
      }

      if (options.autoFields.user) {
        extensions.user_id = z.string().optional();
      }

      if (options.autoFields.organization) {
        extensions.organization_id = z.string().optional();
      }

      extendedSchema = (baseSchema as any).extend(extensions);
    }

    return extendedSchema;
  }  
  // get table config
  getTableConfig(table: string): TableConfig | undefined {
    return this.tableConfigs.get(table);
  }
  
  // Thêm hàm getTable với type inference tự động từ tableConfigs
  getTable(table: string): GenericTable<any> | undefined {
    const tableInstance = this.tables.get(table);
    if (!tableInstance) {
      return undefined;
    }
    
    // Tự động lấy kiểu từ tableConfigs
    const config = this.tableConfigs.get(table);
    if (config) {
      // Ép kiểu dựa trên schema trong tableConfigs
      type InferredType = z.infer<typeof config.schema>;
      return tableInstance as GenericTable<InferredType>;
    }
    
    // Nếu không có config, trả về với kiểu any
    return tableInstance;
  }
  table<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options: TableOptions = {}
  ): GenericTable<z.infer<T>> {
    if (!this.tables.has(name)) {
      // Register table configuration
      this.registerTable(name, schema, options);
      
      const table = new GenericTable<z.infer<T>>(
        name,
        schema,
        this.storage,
        this.currentUserId,
        () => options.organizationScoped ? this.organizationContext : undefined,
        this.broadcast
      );
      
      this.tables.set(name, table);
    } 
    
    return this.tables.get(name)! as GenericTable<z.infer<T>>;
  }

  // DYNAMIC OPERATIONS METHODS
  async dynamicInsert(tableName: string, data: any): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);
    const processedData = await DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create',
      getNextId: (table) => this.getNextId(table),
      tableName
    });
    const operation = DynamicSchemaManager.createInsertOperation(tableName, processedData);
    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicUpdate(tableName: string, id: number, data: any): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const idData = await this.dynamicSelect(tableName, { field: 'id', operator: '=', value: Number(id) });
    if (idData.length === 0) {
      throw new Error(`No record found with id: ${id}`);
    }
    const updateData = { ...idData[0], ...data };
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const processedData = await DynamicDataBuilder.buildData(updateData, extendedSchema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'update',
      tableName
    });
    const operation = DynamicSchemaManager.createUpdateOperation(
      tableName, 
      id, 
      processedData
    );
    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicUpsert(tableName: string, data: any, conflictField?: string): Promise<any> {
    
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
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create',
      getNextId: (table) => this.getNextId(table),
      tableName
    });
    
    const updateData = DynamicDataBuilder.transformData(DynamicDataBuilder.preprocessData(data, config.schema), config.schema);
    const operation = DynamicSchemaManager.createUpsertOperation(
      tableName, 
      processedData, 
      updateData,
      conflictFieldToUse
    );
    
    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicDelete(tableName: string, id: number): Promise<void> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    
    const operation = DynamicSchemaManager.createDeleteByIdOperation(tableName, id);
    await this.execTransaction([operation]);
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
    await this.execTransaction([operation]);
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

    const results = await this.execSelectSQL(operation.sql, operation.params);        

    // Parse results back to validated objects
    return results.map(row => 
      DynamicDataBuilder.parseFromDatabase(row, extendedSchema)
    );
  }

  async dynamicBatchInsert(tableName: string, dataArray: any[]): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const operations: DynamicOperation[] = [];
    const results: any[] = [];
    
    for (const data of dataArray) {
      
      const processedData = await DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
        currentUserId: this.currentUserId,
        organizationId: this.organizationContext,
        operation: 'create',
        getNextId: (table) => this.getNextId(table),
        tableName
      });

      const operation = DynamicSchemaManager.createInsertOperation(
        tableName, 
        processedData
      );

      operations.push(operation);
      results.push(processedData);
    }

    await this.execTransaction(operations);
    return results;
  }

  // BATCH OPERATIONS WITH MULTIPLE TABLES
  async dynamicMultiTableTransaction(operations: Array<{
    table?: string;
    operation: 'insert' | 'update' | 'upsert' | 'delete' | 'sql';
    data?: any;
    id?: number;
    conflictField?: string;
    where?: { field: string; operator: string; value: any };
  }>): Promise<any[]> {
    const sqlOperations: DynamicOperation[] = [];
    const results: any[] = [];

    for (const op of operations) {
      
      let sqlOp: DynamicOperation;
      let config: TableConfig | undefined;
      let extendedSchema: any;
      
      switch (op.operation) {
        case 'insert':
          if (!op.data) throw new Error('Data required for insert operation');
          if (!op.table) throw new Error('Table required for insert operation'); 
          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }
          extendedSchema = this.createExtendedSchema(config.schema, config.options);
          const insertData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create',
            getNextId: (table) => this.getNextId(table),
            tableName: op.table
          });
          sqlOp = DynamicSchemaManager.createInsertOperation(op.table!, insertData);
          results.push(insertData);
          sqlOperations.push(sqlOp);
          break;

        case 'update':
          if (!op.id) throw new Error('ID required for update operation');
          if (!op.data) throw new Error('Data required for update operation');     
          if (!op.table) throw new Error('Table required for update operation'); 
          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }
          extendedSchema = this.createExtendedSchema(config.schema, config.options);
               
          const updateData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'update',
            tableName: op.table
          });
          sqlOp = DynamicSchemaManager.createUpdateOperation(op.table, op.id, updateData);
          results.push(updateData);
          sqlOperations.push(sqlOp);
          break;

        case 'upsert':
          if (!op.data) throw new Error('Data required for upsert operation');
          if (!op.table) throw new Error('Table required for upsert operation'); 
          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }
          extendedSchema = this.createExtendedSchema(config.schema, config.options);
          const upsertData = await DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create',
            getNextId: (table) => this.getNextId(table),
            tableName: op.table
          });
          const conflictField = op.conflictField || config.options.conflictField;
          if (!conflictField) throw new Error('Conflict field required for upsert operation');
          sqlOp = DynamicSchemaManager.createUpsertOperation(op.table, upsertData, op.data, conflictField);
          results.push(upsertData);
          sqlOperations.push(sqlOp);
          break;

        case 'delete':
          if (!op.table) throw new Error('Table required for upsert operation'); 
          config = this.tableConfigs.get(op.table);
          if (!config) {
            throw new Error(`Table ${op.table} not registered`);
          }
          if (op.id) {
            // Delete by ID
            sqlOp = DynamicSchemaManager.createDeleteByIdOperation(op.table, op.id);
            results.push({ id: op.id, deleted: true });
          } else if (op.where) {
            // Delete by condition
            sqlOp = DynamicSchemaManager.createDeleteOperation(op.table, op.where);
            results.push({ where: op.where, deleted: true });
          } else {
            throw new Error('ID or where condition required for delete operation');
          }
          sqlOperations.push(sqlOp);
          break;
        case 'sql':
          if (!op.data) throw new Error('Data required for insert operation');
          for (const itemOp of op.data) {
            sqlOperations.push(itemOp);  
          }
          break;
        default:
          throw new Error(`Unknown operation: ${op.operation}`);
      }      
    }

    await this.execTransaction(sqlOperations);
    return results;
  }

  // EXISTING METHODS (with minor improvements)

  get raw() {
    return this.storage.sql;
  } 

  private ensureTableExists(name: string, schema: z.ZodSchema, options: TableOptions): void {
    const schemaShape = this.extractSchemaShape(schema);
    const columns = this.buildColumnDefinitions(schemaShape, options);

    const createSQL = `CREATE TABLE IF NOT EXISTS "${name}" (
      ${columns.join(',\n      ')}
    )`;

    try {
      this.storage.sql.exec(createSQL);      
    } catch (err) {
      console.error(`Error in ensureTableExists, sql: ${createSQL}`);
      throw err;
    }
    this.createIndexes(name, options);
  }
  
  private extractSchemaShape(schema: z.ZodSchema): Record<string, z.ZodTypeAny> {
    // Base case: ZodObject
    if (schema instanceof z.ZodObject) {
      return schema.shape;
    }
    
    // ZodEffects từ .refine(), .transform(), etc.
    if (schema instanceof z.ZodEffects) {
      return this.extractSchemaShape(schema._def.schema);
    }
    
    // ZodOptional, ZodDefault, ZodNullable
    if (schema instanceof z.ZodOptional || 
        schema instanceof z.ZodDefault || 
        schema instanceof z.ZodNullable) {
      return this.extractSchemaShape(schema._def.innerType);
    }
    
    // ZodArray
    if (schema instanceof z.ZodArray) {
      // Mảng được lưu dưới dạng JSON string
      return {};
    }
    
    // ZodRecord - được lưu dưới dạng JSON string
    if (schema instanceof z.ZodRecord) {
      return {};
    }
    
    // ZodMap - được lưu dưới dạng JSON string
    if (schema instanceof z.ZodMap) {
      return {};
    }
    
    // ZodTuple - được lưu dưới dạng JSON string
    if (schema instanceof z.ZodTuple) {
      return {};
    }
    
    // ZodLazy
    if (schema instanceof z.ZodLazy) {
      try {
        return this.extractSchemaShape(schema._def.getter());
      } catch {
        return {};
      }
    }
    
    // ZodUnion, ZodIntersection - try to extract shape from all options
    if (schema instanceof z.ZodUnion) {
      const options = schema._def.options as z.ZodTypeAny[];
      const allShapes = options.map(opt => this.extractSchemaShape(opt));
      // Merge all shapes
      const merged: Record<string, z.ZodTypeAny> = {};
      allShapes.forEach(shape => {
        Object.assign(merged, shape);
      });
      return merged;
    }
    
    if (schema instanceof z.ZodIntersection) {
      const leftShape = this.extractSchemaShape(schema._def.left);
      const rightShape = this.extractSchemaShape(schema._def.right);
      return { ...leftShape, ...rightShape };
    }
    
    return {};
  }  

  private buildColumnDefinitions(schemaShape: any, options: TableOptions): string[] {
    const columns: string[] = [];

    // Add auto fields based on configuration
    if (options.autoFields?.id !== false) {
      // ID giờ là số tự tăng, sử dụng INTEGER PRIMARY KEY AUTOINCREMENT cho SQLite
      columns.push('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
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
    // Recursively unwrap Zod types
    const unwrappedType = this.unwrapZodType(zodType);
        
    // Map to SQLite types
    if (unwrappedType instanceof z.ZodString) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodNumber) {
      return this.isIntegerType(unwrappedType) ? 'INTEGER' : 'REAL';
    } else if (unwrappedType instanceof z.ZodBoolean) {
      return 'INTEGER';
    } else if (unwrappedType instanceof z.ZodDate) {
      return 'INTEGER';
    } else if (unwrappedType instanceof z.ZodBigInt) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodEnum) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodNativeEnum) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodLiteral) {
      // Check literal value type
      const value = (unwrappedType as any)._def.value;
      if (typeof value === 'boolean') {
        return 'INTEGER';
      } else if (typeof value === 'number') {
        return Number.isInteger(value) ? 'INTEGER' : 'REAL';
      } else {
        return 'TEXT';
      }
    } else if (unwrappedType instanceof z.ZodRecord || 
               unwrappedType instanceof z.ZodMap ||
               unwrappedType instanceof z.ZodArray ||
               unwrappedType instanceof z.ZodTuple ||
               unwrappedType instanceof z.ZodObject) {
      // Record, Map, Array, Tuple, Object đều được lưu dưới dạng JSON string
      return 'TEXT';
    } else {
      // Default cho các type khác
      return 'TEXT';
    }
  }

  /**
   * Recursively unwrap Zod types
   */
  private unwrapZodType(zodType: z.ZodTypeAny): z.ZodTypeAny {
    const def = (zodType as any)._def;
    
    // Handle ZodEffects (preprocess/transform/refine)
    if (zodType instanceof z.ZodEffects) {
      if (def.schema) {
        return this.unwrapZodType(def.schema);
      }
      if (def.innerType) {
        return this.unwrapZodType(def.innerType);
      }
    }
    
    // Handle other wrapper types
    if (zodType instanceof z.ZodOptional ||
        zodType instanceof z.ZodNullable ||
        zodType instanceof z.ZodDefault ||
        zodType instanceof z.ZodBranded ||
        zodType instanceof z.ZodReadonly ||
        zodType instanceof z.ZodCatch ||
        zodType instanceof z.ZodPromise) {
      
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
    
    // Handle ZodLazy
    if (zodType instanceof z.ZodLazy && def.getter) {
      try {
        return this.unwrapZodType(def.getter());
      } catch {
        return z.string();
      }
    }
    
    // Handle pipeline
    if ((zodType as any).constructor.name === 'ZodPipeline' && def.in) {
      return this.unwrapZodType(def.in);
    }
    
    // Handle unions
    if (zodType instanceof z.ZodUnion) {
      const options = def.options as z.ZodTypeAny[];
      const unwrappedTypes = options.map(opt => this.unwrapZodType(opt));
      
      // Try to find a boolean type in the union
      const booleanType = unwrappedTypes.find(t => t instanceof z.ZodBoolean);
      if (booleanType) return booleanType;
      
      // Try to find a number type
      const numberType = unwrappedTypes.find(t => t instanceof z.ZodNumber);
      if (numberType) return numberType;
      
      // Try to find a string type
      const stringType = unwrappedTypes.find(t => t instanceof z.ZodString);
      if (stringType) return stringType;
      
      // Try to find a record type
      const recordType = unwrappedTypes.find(t => t instanceof z.ZodRecord);
      if (recordType) return recordType;
      
      // Try to find an array type
      const arrayType = unwrappedTypes.find(t => t instanceof z.ZodArray);
      if (arrayType) return arrayType;
      
      // Try to find an object type
      const objectType = unwrappedTypes.find(t => t instanceof z.ZodObject);
      if (objectType) return objectType;
      
      // Return first type
      return unwrappedTypes[0] || z.string();
    }
    
    // Handle intersections
    if (zodType instanceof z.ZodIntersection) {
      const left = this.unwrapZodType(def.left);
      const right = this.unwrapZodType(def.right);
      
      // Prefer boolean > number > string > record/array/object > other
      if (left instanceof z.ZodBoolean || right instanceof z.ZodBoolean) {
        return z.boolean();
      }
      if (left instanceof z.ZodNumber || right instanceof z.ZodNumber) {
        return z.number();
      }
      if (left instanceof z.ZodString || right instanceof z.ZodString) {
        return z.string();
      }
      if (left instanceof z.ZodRecord || right instanceof z.ZodRecord) {
        return z.record(z.any());
      }
      if (left instanceof z.ZodArray || right instanceof z.ZodArray) {
        return z.array(z.any());
      }
      if (left instanceof z.ZodObject || right instanceof z.ZodObject) {
        return z.object({});
      }
      
      return left;
    }
    
    // Handle discriminated unions
    if (zodType instanceof z.ZodDiscriminatedUnion) {
      const allTypes: z.ZodTypeAny[] = [];
      for (const options of def.options.values()) {
        options.forEach((opt: z.ZodTypeAny) => 
          allTypes.push(this.unwrapZodType(opt))
        );
      }
      
      // Similar logic to regular union
      const booleanType = allTypes.find(t => t instanceof z.ZodBoolean);
      if (booleanType) return booleanType;
      
      const numberType = allTypes.find(t => t instanceof z.ZodNumber);
      if (numberType) return numberType;
      
      const stringType = allTypes.find(t => t instanceof z.ZodString);
      if (stringType) return stringType;
      
      const recordType = allTypes.find(t => t instanceof z.ZodRecord);
      if (recordType) return recordType;
      
      const arrayType = allTypes.find(t => t instanceof z.ZodArray);
      if (arrayType) return arrayType;
      
      const objectType = allTypes.find(t => t instanceof z.ZodObject);
      if (objectType) return objectType;
      
      return allTypes[0] || z.string();
    }
    
    // Return the type as-is
    return zodType;
  }

  /**
   * Check if a ZodNumber type represents an integer
   */
  private isIntegerType(zodNumber: z.ZodNumber): boolean {
    const checks = (zodNumber as any)._def.checks || [];
    return checks.some((check: any) => check.kind === 'int');
  }
  
  private createIndexes(tableName: string, options: TableOptions): void {
    // Create regular indexes
    for (const index of options.indexes || []) {
      const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${index}" ON "${tableName}" ("${index}")`;
      try {
        this.storage.sql.exec(indexSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${indexSQL}`);
        throw e;
      }                        
    }

    // Create unique indexes
    for (const uniqueIndex of options.uniqueIndexes || []) {
      const uniqueIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_${uniqueIndex}" ON "${tableName}" ("${uniqueIndex}")`;
      try {
        this.storage.sql.exec(uniqueIndexSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${uniqueIndexSQL}`);
        throw e;
      }                  
    }

    // Create composite unique indexes for user/organization scoped tables
    if (options.userScoped && options.organizationScoped) {
      const compositeUniqueSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_user_org" ON "${tableName}" ("user_id", "organization_id")`;
      try {
        this.storage.sql.exec(compositeUniqueSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${compositeUniqueSQL}`);
        throw e;
      }      
    }
  }

  async execTransaction(operations: Array<{ sql: string; params?: any[] }>): Promise<void> {
    if (!operations.length) {
      throw new Error('Empty transaction');
    }    
    await this.storage.transactionSync(async () => {
      for (const op of operations) {
        try {
          this.storage.sql.exec(op.sql, ...(op.params || []));              
        }
        catch (e) {
          console.error(`Error in execTransaction, sql: ${op.sql}, params: ${JSON.stringify((op.params || []))}`);
          throw e;
        }
      }        
    });
  }

  async execSelectSQL(sql: string, params: any[] = [], table?: string): Promise<any[]> {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT statements are allowed in execSelectSQL');
    }      
    let cursor;
    try {
      cursor = this.storage.sql.exec(sql, ...params);
    }
    catch (e) {
      console.error(`Error in execSelectSQL, sql: ${sql}, params: ${JSON.stringify(params)}`);
      throw e;
    }
    const result = cursor.toArray();
    if (table && table !== '') {
      const config = this.tableConfigs.get(table);
      if (!config) {
        throw new Error(`Table ${table} not registered`);
      }
      console.log(`Parsing ${table} results: ${JSON.stringify(result)}`);
      return result.map(row => 
        DynamicDataBuilder.parseFromDatabase(row, config.schema)
      );
    }
    return result;
  }
}