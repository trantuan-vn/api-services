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
import { z } from 'zod';

// Utility function to check schema type without instanceof issues
const getSchemaTypeName = (schema: any): string => {
	return schema?.constructor?.name || 'Unknown';
};

const isZodObject = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodObject';
};

const isZodOptional = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodOptional';
};

const isZodDefault = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodDefault';
};

const isZodString = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodString';
};

const isZodNumber = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodNumber';
};

const isZodBoolean = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodBoolean';
};

const isZodDate = (schema: any): boolean => {
	return getSchemaTypeName(schema) === 'ZodDate';
};

/**
 * Pipeline field definition theo format Cloudflare Pipelines
 * https://developers.cloudflare.com/pipelines/getting-started/
 */
export interface PipelineField {
	name: string;
	type: 'string' | 'int64' | 'float64' | 'bool' | 'timestamp';
	required: boolean;
}

/**
 * Pipeline schema definition theo format Cloudflare Pipelines
 */
export interface PipelineSchema {
	fields: PipelineField[];
}

/**
 * Pipeline configuration cho từng schema
 * Mỗi schema tương ứng với 1 pipeline sẽ sync data từ D1 sang R2 Data Catalog (Apache Iceberg)
 */
export interface PipelineConfig {
	schemaName: string;
	tableName: string;
	schema: z.ZodSchema; // Zod schema để validate
	pipelineSchema: PipelineSchema; // Pipeline schema format cho Cloudflare Pipelines
	pipelineEndpoint?: string; // HTTP endpoint URL của pipeline (ví dụ: https://{stream-id}.ingest.cloudflare.com)
	namespace: string; // Namespace trong R2 Data Catalog (thường là 'default')
	r2BucketName: string; // Tên R2 bucket
}

/**
 * Helper function để tạo pipeline schema từ Zod schema
 * Chuyển đổi các field types từ Zod sang Cloudflare Pipelines format
 */
function createPipelineSchemaFromZod(zodSchema: z.ZodSchema): PipelineSchema {
	// Lấy shape từ Zod object schema
	if (!isZodObject(zodSchema)) {
		// Fallback: return empty schema nếu không phải ZodObject
		return { fields: [] };
	}

	const shape = (zodSchema as any).shape;
	const fields: PipelineField[] = [];

	for (const [key, value] of Object.entries(shape)) {
		let type: PipelineField['type'] = 'string';
		let required = true;
		let zodType: z.ZodTypeAny = value as z.ZodTypeAny;

		// Handle optional và default
		if (isZodOptional(zodType)) {
			required = false;
			zodType = (zodType as any)._def.innerType;
		} else if (isZodDefault(zodType)) {
			required = false;
			zodType = (zodType as any)._def.innerType;
		}

		// Map Zod types to Pipeline types
		if (isZodString(zodType)) {
			type = 'string';
		} else if (isZodNumber(zodType)) {
			// Heuristic: nếu field name chứa 'id' hoặc 'count', dùng int64
			if (key.toLowerCase().includes('id') || key.toLowerCase().includes('count')) {
				type = 'int64';
			} else {
				type = 'float64';
			}
		} else if (isZodBoolean(zodType)) {
			type = 'bool';
		} else if (isZodDate(zodType)) {
			type = 'timestamp';
		} else if (key.toLowerCase().includes('time') || key.toLowerCase().includes('at') || key.toLowerCase().endsWith('_at')) {
			// Heuristic cho timestamp fields
			type = 'timestamp';
		}

		fields.push({ name: key, type, required });
	}

	return { fields };
}

/**
 * Export pipeline schema as JSON format for use with `wrangler pipelines setup`
 * Có thể sử dụng function này để generate schema files khi setup pipelines
 */
export function exportPipelineSchemaAsJSON(config: PipelineConfig): string {
	return JSON.stringify(config.pipelineSchema, null, 2);
}

/**
 * Pipeline configurations
 * Mỗi pipeline sẽ gửi data đến R2 Data Catalog dưới dạng Apache Iceberg table
 * 
 * Lưu ý: pipelineEndpoint sẽ được set qua environment variable hoặc được tạo tự động
 * khi pipeline được setup qua Wrangler CLI hoặc Dashboard
 * 
 * Để export schema JSON cho một pipeline:
 * import { PIPELINE_CONFIGS, exportPipelineSchemaAsJSON } from './config';
 * const schema = exportPipelineSchemaAsJSON(PIPELINE_CONFIGS[0]);
 * console.log(schema);
 */
export const PIPELINE_CONFIGS: PipelineConfig[] = [
	{
		schemaName: 'PricePolicySchema',
		tableName: 'price_policies',
		schema: PricePolicySchema,
		pipelineSchema: createPipelineSchemaFromZod(PricePolicySchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'ServiceSchema',
		tableName: 'services',
		schema: ServiceSchema,
		pipelineSchema: createPipelineSchemaFromZod(ServiceSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'VoucherSchema',
		tableName: 'vouchers',
		schema: VoucherSchema,
		pipelineSchema: createPipelineSchemaFromZod(VoucherSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'UserSchema',
		tableName: 'users',
		schema: UserSchema,
		pipelineSchema: createPipelineSchemaFromZod(UserSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'SessionSchema',
		tableName: 'sessions',
		schema: SessionSchema,
		pipelineSchema: createPipelineSchemaFromZod(SessionSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'ConnectionSchema',
		tableName: 'connections',
		schema: ConnectionSchema,
		pipelineSchema: createPipelineSchemaFromZod(ConnectionSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'SubscriptionSchema',
		tableName: 'subscriptions',
		schema: SubscriptionSchema,
		pipelineSchema: createPipelineSchemaFromZod(SubscriptionSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'OrderSchema',
		tableName: 'orders',
		schema: OrderSchema,
		pipelineSchema: createPipelineSchemaFromZod(OrderSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'ServiceUsageSchema',
		tableName: 'service_usages',
		schema: ServiceUsageSchema,
		pipelineSchema: createPipelineSchemaFromZod(ServiceUsageSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'OrderItemSchema',
		tableName: 'order_items',
		schema: OrderItemSchema,
		pipelineSchema: createPipelineSchemaFromZod(OrderItemSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'OrderItemDiscountSchema',
		tableName: 'order_discounts',
		schema: OrderItemDiscountSchema,
		pipelineSchema: createPipelineSchemaFromZod(OrderItemDiscountSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'PaymentSchema',
		tableName: 'payments',
		schema: PaymentSchema,
		pipelineSchema: createPipelineSchemaFromZod(PaymentSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'RefundSchema',
		tableName: 'refunds',
		schema: RefundSchema,
		pipelineSchema: createPipelineSchemaFromZod(RefundSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'ApiTokenSchema',
		tableName: 'api_tokens',
		schema: ApiTokenSchema,
		pipelineSchema: createPipelineSchemaFromZod(ApiTokenSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'VersionInfoSchema',
		tableName: 'versions',
		schema: VersionInfoSchema,
		pipelineSchema: createPipelineSchemaFromZod(VersionInfoSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
	{
		schemaName: 'PendingMessageSchema',
		tableName: 'pending_messages',
		schema: PendingMessageSchema,
		pipelineSchema: createPipelineSchemaFromZod(PendingMessageSchema),
		namespace: 'default',
		r2BucketName: 'lakehouse',
	},
];

