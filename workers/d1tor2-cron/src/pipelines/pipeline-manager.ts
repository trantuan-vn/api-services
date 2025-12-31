import { z } from 'zod';
import { PIPELINE_CONFIGS, PipelineConfig } from './config';
import { CloudflarePipelineAPIService } from './pipeline-api-service';

export interface PipelineResult {
	pipelineName: string;
	tableName: string;
	success: boolean;
	recordsProcessed: number;
	error?: string;
	timestamp: string;
}

export interface PipelineStats {
	totalPipelines: number;
	successful: number;
	failed: number;
	results: PipelineResult[];
}

/**
 * Pipeline Manager - Quản lý việc sync data từ D1 database sang R2 Data Catalog
 * Sử dụng Cloudflare Pipelines để gửi data qua HTTP endpoints
 * Data sẽ được lưu dưới dạng Apache Iceberg tables trong R2 Data Catalog
 * 
 * Reference: https://developers.cloudflare.com/pipelines/getting-started/
 */
export class PipelineManager {
	private apiService: CloudflarePipelineAPIService | null = null;
	private endpointCache: Map<string, string> = new Map();

	constructor(
		private db: D1Database,
		private env: Env,
		private accountId: string,
		private apiToken: string,
	) {
		if (accountId && apiToken) {
			try {
				this.apiService = new CloudflarePipelineAPIService(accountId, apiToken);
			} catch (error) {
				console.warn('Failed to initialize Cloudflare Pipeline API Service:', error);
				console.warn('Pipelines will need to be created manually or endpoints configured via env vars');
			}
		} else {
			console.warn('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not found. Pipelines must be created manually or endpoints configured via env vars');
		}
	}

	/**
	 * Chạy tất cả các pipelines
	 */
	async runAllPipelines(): Promise<PipelineStats> {
		const results: PipelineResult[] = [];
		let successful = 0;
		let failed = 0;

		console.log(`Starting ${PIPELINE_CONFIGS.length} pipelines...`);

		for (const config of PIPELINE_CONFIGS) {
			try {
				const result = await this.runPipeline(config);
				results.push(result);
				if (result.success) {
					successful++;
				} else {
					failed++;
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Pipeline ${config.schemaName} failed:`, errorMessage);
				results.push({
					pipelineName: config.schemaName,
					tableName: config.tableName,
					success: false,
					recordsProcessed: 0,
					error: errorMessage,
					timestamp: new Date().toISOString(),
				});
				failed++;
			}
		}

		return {
			totalPipelines: PIPELINE_CONFIGS.length,
			successful,
			failed,
			results,
		};
	}

	/**
	 * Chạy một pipeline cụ thể
	 */
	async runPipeline(config: PipelineConfig): Promise<PipelineResult> {
		const startTime = Date.now();
		console.log(`Running pipeline: ${config.schemaName} (table: ${config.tableName})`);

		try {
			// 0. Đảm bảo pipeline, stream và sink đã được tạo
			await this.ensurePipelineSetup(config);

			// 1. Lấy dữ liệu từ D1
			const records = await this.fetchDataFromD1(config.tableName);
			console.log(`  Found ${records.length} records in ${config.tableName}`);

			if (records.length === 0) {
				return {
					pipelineName: config.schemaName,
					tableName: config.tableName,
					success: true,
					recordsProcessed: 0,
					timestamp: new Date().toISOString(),
				};
			}

			// 2. Validate và transform dữ liệu theo Zod schema
			const validatedRecords = this.validateRecords(records, config.schema);

			// 3. Gửi data đến Cloudflare Pipeline HTTP endpoint
			// Data sẽ được pipeline xử lý và lưu vào R2 Data Catalog dưới dạng Iceberg table
			await this.sendToPipeline(config, validatedRecords);

			const duration = Date.now() - startTime;
			console.log(`  Pipeline ${config.schemaName} completed in ${duration}ms`);

			return {
				pipelineName: config.schemaName,
				tableName: config.tableName,
				success: true,
				recordsProcessed: records.length,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`  Pipeline ${config.schemaName} failed:`, errorMessage);
			throw error;
		}
	}

	/**
	 * Đảm bảo pipeline, stream và sink đã được tạo cho schema
	 * Kiểm tra xem schema đã có pipeline chưa, nếu chưa thì tạo mới
	 * Sau đó cập nhật endpoint stream theo stream-id tương ứng
	 */
	private async ensurePipelineSetup(config: PipelineConfig): Promise<void> {
		// Nếu đã có endpoint trong cache, không cần làm gì
		if (this.endpointCache.has(config.schemaName)) {
			return;
		}

		// Kiểm tra endpoint từ config trước
		if (config.pipelineEndpoint) {
			this.endpointCache.set(config.schemaName, config.pipelineEndpoint);
			return;
		}

		// Nếu có API service, kiểm tra xem schema đã có pipeline chưa
		if (this.apiService) {
			try {
				// Kiểm tra xem pipeline đã tồn tại cho schema này chưa
				const pipelineExists = await this.apiService.pipelineExistsForSchema(config.schemaName, config.tableName);
				
				if (!pipelineExists) {
					// Nếu chưa có pipeline, tạo pipeline, stream, sink và cập nhật endpoint
					console.log(`Schema ${config.schemaName} chưa có pipeline, đang tạo mới...`);
				} else {
					console.log(`Schema ${config.schemaName} đã có pipeline, đang kiểm tra endpoint...`);
				}

				// Đảm bảo pipeline tồn tại và lấy endpoint (tạo mới nếu cần)
				const endpoint = await this.apiService.ensurePipelineExists(config);
				if (endpoint) {
					// Lưu endpoint vào cache
					this.endpointCache.set(config.schemaName, endpoint);
					console.log(`Pipeline cho schema ${config.schemaName} đã sẵn sàng với endpoint: ${endpoint}`);
					return;
				}
			} catch (error) {
				console.warn(`Failed to ensure pipeline exists for schema ${config.schemaName}:`, error);
				// Tiếp tục với việc lấy endpoint từ env/config (đã check ở trên)
			}
		}
	}

	/**
	 * Lấy dữ liệu từ D1 database
	 */
	private async fetchDataFromD1(tableName: string): Promise<any[]> {
		try {
			const query = `SELECT * FROM ${tableName} LIMIT 10000`;
			const result = await this.db.prepare(query).all();

			if (!result.results) {
				return [];
			}

			return result.results as any[];
		} catch (error) {
			// Nếu bảng không tồn tại, trả về mảng rỗng
			if (error instanceof Error && error.message.includes('no such table')) {
				console.warn(`Table ${tableName} does not exist, skipping...`);
				return [];
			}
			throw error;
		}
	}

	/**
	 * Gửi dữ liệu đến Cloudflare Pipeline HTTP endpoint
	 * Pipeline sẽ xử lý và lưu data vào R2 Data Catalog dưới dạng Apache Iceberg table
	 * 
	 * Reference: https://developers.cloudflare.com/pipelines/getting-started/
	 * 
	 * Format: POST https://{stream-id}.ingest.cloudflare.com
	 * Body: JSON array of records
	 */
	private async sendToPipeline(config: PipelineConfig, records: any[]): Promise<void> {
		// Lấy pipeline endpoint từ cache, config hoặc environment variable
		let endpoint = this.endpointCache.get(config.schemaName) || config.pipelineEndpoint;
		
		if (!endpoint) {
			// Try to get from environment variables
			const envKey = `PIPELINE_${config.schemaName.toUpperCase()}_ENDPOINT`;
			// Access env vars safely - they should be defined in wrangler.jsonc vars section
			const envValue = (this.env as any)[envKey];
			if (typeof envValue === 'string') {
				endpoint = envValue;
				this.endpointCache.set(config.schemaName, endpoint);
			}
		}

		if (!endpoint) {
			throw new Error(
				`Pipeline endpoint not configured for ${config.schemaName}. ` +
				`Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to auto-create pipelines, ` +
				`or set PIPELINE_${config.schemaName.toUpperCase()}_ENDPOINT environment variable ` +
				`or configure pipelineEndpoint in config. ` +
				`You can get the endpoint URL after creating the pipeline via: ` +
				`npx wrangler pipelines setup or from the Cloudflare Dashboard.`
			);
		}

		// Validate endpoint URL format
		if (!endpoint.startsWith('https://') || !endpoint.includes('.ingest.cloudflare.com')) {
			throw new Error(`Invalid pipeline endpoint format: ${endpoint}. Expected format: https://{stream-id}.ingest.cloudflare.com`);
		}

		// Gửi data đến pipeline endpoint
		// Pipeline sẽ tự động xử lý và lưu vào R2 Data Catalog
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(records),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(
				`Failed to send data to pipeline ${config.schemaName}: ` +
				`${response.status} ${response.statusText}. ${errorText}`
			);
		}

		console.log(`  Sent ${records.length} records to pipeline ${config.schemaName} (endpoint: ${endpoint})`);
	}

	/**
	 * Validate records với Zod schema
	 * Đảm bảo data đúng format trước khi gửi đến pipeline
	 */
	private validateRecords(records: any[], schema: z.ZodSchema): any[] {
		const validatedRecords: any[] = [];
		const errors: string[] = [];

		for (let i = 0; i < records.length; i++) {
			const result = schema.safeParse(records[i]);
			if (result.success) {
				validatedRecords.push(result.data);
			} else {
				errors.push(`Record ${i}: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
			}
		}

		if (errors.length > 0) {
			console.warn(`Validation warnings for ${errors.length} records:`, errors.slice(0, 5));
			if (errors.length > 5) {
				console.warn(`... and ${errors.length - 5} more validation errors`);
			}
		}

		return validatedRecords;
	}

	/**
	 * Chạy một pipeline cụ thể theo tên schema
	 */
	async runPipelineByName(schemaName: string): Promise<PipelineResult> {
		const config = PIPELINE_CONFIGS.find((c) => c.schemaName === schemaName);
		if (!config) {
			throw new Error(`Pipeline config not found for schema: ${schemaName}`);
		}
		return this.runPipeline(config);
	}
}

