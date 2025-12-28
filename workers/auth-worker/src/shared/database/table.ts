import { z } from 'zod';
import { GenericQuery } from './query.js';

// Type alias for better DX
export type Table<T = any> = GenericTable<T>;

export class GenericTable<T = any> {
  constructor(
    private tableName: string,
    private schema: z.ZodSchema<T>,
    private storage: DurableObjectStorage,
    private userId: string,
    private getOrganizationContext: () => string | undefined,
    private broadcast?: (event: string, data: any) => void
  ) { }

  private get organizationContext(): string | undefined {
    return this.getOrganizationContext();
  }

  // Helper method to build WHERE clause for user/organization context
  private buildWhereClause(): { whereClause: string; params: any[] } {
    if (this.organizationContext) {
      return {
        whereClause: 'WHERE user_id = ? AND organization_id = ?',
        params: [this.userId, this.organizationContext]
      };
    } else {
      return {
        whereClause: 'WHERE user_id = ?',
        params: [this.userId]
      };
    }
  }

  where(path: string, operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'in', value: any): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).where(path, operator, value);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).orderBy(field, direction);
  }

  limit(count: number): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).limit(count);
  }

  async getAll(): Promise<Array<T & { id: string; createdAt: Date; updatedAt: Date }>> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).get();
  }

  async count(): Promise<number> {
    const { whereClause, params } = this.buildWhereClause();
    const sql = `SELECT COUNT(*) as count FROM "${this.tableName}" ${whereClause}`;

    const cursor = this.storage.sql.exec(sql, ...params);
    const results = cursor.toArray();
    if (results.length === 0) {
      return 0;
    }
    const firstResult = results[0];
    return firstResult ? Number(firstResult.count) : 0;
  }

  // ============ BROADCAST METHODS ============   
  broadcastToUser(event: string, data: any) {
    this.broadcast?.(event, data);
  }
}