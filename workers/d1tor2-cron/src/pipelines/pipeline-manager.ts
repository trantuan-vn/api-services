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
	 * Tính toán concurrency limit tối ưu dựa trên Cloudflare Workers limits và environment variables
	 * 
	 * Cloudflare Workers limits:
	 * - 50 concurrent subrequests (HTTP requests) per worker
	 * - ~128MB memory default
	 * - Cron workers có thể có nhiều thời gian hơn nhưng vẫn cần giới hạn để tránh quá tải
	 * 
	 * @param type Loại concurrency: 'pipeline' hoặc 'batch'
	 * @param totalItems Tổng số items (pipelines hoặc batches) để tính toán heuristic
	 * @returns Concurrency limit tối ưu
	 */
	private getConcurrencyLimit(type: 'pipeline' | 'batch', totalItems?: number): number {
		// Ưu tiên lấy từ environment variables
		const envKey = type === 'pipeline' 
			? 'PIPELINE_CONCURRENCY_LIMIT' 
			: 'BATCH_CONCURRENCY_LIMIT';
		
		const envValue = (this.env as any)[envKey];
		if (envValue !== undefined) {
			const limit = parseInt(String(envValue), 10);
			if (!isNaN(limit) && limit > 0) {
				console.log(`  Using ${envKey} from env: ${limit}`);
				return Math.min(limit, 20); // Cap at 20 để tránh quá tải
			}
		}

		// Heuristic dựa trên Cloudflare Workers limits
		// Mỗi pipeline/batch có thể tạo:
		// - 1-3 D1 queries (query, delete)
		// - 1 HTTP request (send to pipeline endpoint)
		// - Có thể có thêm subrequests trong quá trình xử lý
		// Pipeline concurrency: mỗi pipeline có thể tạo ~3-5 subrequests
		// Với 50 concurrent subrequests limit, có thể chạy ~10-15 pipelines
		// Nhưng để an toàn và tối ưu memory, giới hạn ở 5-8
		// Batch concurrency: mỗi batch có thể tạo ~2-3 subrequests
		// Với 50 concurrent subrequests limit, có thể chạy ~15-20 batches
		// Nhưng để tối ưu memory và tránh quá tải D1, giới hạn ở 3-5
		// Điều chỉnh dựa trên số lượng batches (nếu biết)
		// Batch concurrency thường ổn định ở 3-5

		const defaultLimit = type === 'pipeline'? 5 : 3;
		// Điều chỉnh dựa trên số lượng pipelines
		if (totalItems !== undefined) {
			// Nếu có ít pipelines, có thể tăng concurrency
			if (totalItems <= 5) {
				return Math.min(totalItems, 5);
			}
			// Nếu có nhiều pipelines, giữ ở mức vừa phải
			return defaultLimit;
		}
		
		return defaultLimit;

	}

	/**
	 * Chạy tất cả các pipelines song song
	 * Mỗi pipeline sẽ tự động tìm ngày xa nhất có dữ liệu (trước cutoff = 96 ngày trước) và xử lý
	 * Xử lý nhiều pipelines cùng lúc để tăng hiệu suất
	 */
	async runAllPipelines(): Promise<PipelineStats> {
		const concurrencyLimit = this.getConcurrencyLimit('pipeline', PIPELINE_CONFIGS.length);
		const results: PipelineResult[] = [];
		let successful = 0;
		let failed = 0;

		console.log(`Starting ${PIPELINE_CONFIGS.length} pipelines with concurrency limit of ${concurrencyLimit}...`);

		// Queue để quản lý các pipelines đang được xử lý
		const processingQueue: Array<{ promise: Promise<PipelineResult>; config: PipelineConfig }> = [];
		let configIndex = 0;

		while (configIndex < PIPELINE_CONFIGS.length || processingQueue.length > 0) {
			// Thêm pipelines vào queue cho đến khi đạt giới hạn concurrency
			while (configIndex < PIPELINE_CONFIGS.length && processingQueue.length < concurrencyLimit) {
				const config = PIPELINE_CONFIGS[configIndex];

				// Tạo promise để xử lý pipeline này song song
				const processPromise = this.runPipeline(config)
					.then((result) => {
						console.log(`✓ Pipeline ${config.schemaName} completed: ${result.recordsProcessed} records`);
						return result;
					})
					.catch((error) => {
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error(`✗ Pipeline ${config.schemaName} failed:`, errorMessage);
						return {
							pipelineName: config.schemaName,
							tableName: config.tableName,
							success: false,
							recordsProcessed: 0,
							error: errorMessage,
							timestamp: new Date().toISOString(),
						} as PipelineResult;
					});

				processingQueue.push({ promise: processPromise, config });
				configIndex++;
			}

			// Chờ một pipeline hoàn thành trước khi thêm pipeline tiếp theo
			if (processingQueue.length > 0) {
				// Wrap mỗi promise với index để biết pipeline nào hoàn thành
				const promisesWithIndex = processingQueue.map((item, index) => 
					item.promise
						.then(value => ({ status: 'fulfilled' as const, value, index }))
						.catch(reason => ({ status: 'rejected' as const, reason, index }))
				);
				
				// Chờ pipeline đầu tiên hoàn thành
				const completed = await Promise.race(promisesWithIndex);
				
				const completedItem = processingQueue[completed.index];
				let result: PipelineResult;

				if (completed.status === 'fulfilled') {
					result = completed.value;
				} else {
					// Nếu pipeline failed, tạo error result
					result = {
						pipelineName: completedItem.config.schemaName,
						tableName: completedItem.config.tableName,
						success: false,
						recordsProcessed: 0,
						error: completed.reason instanceof Error ? completed.reason.message : String(completed.reason),
						timestamp: new Date().toISOString(),
					};
				}

				results.push(result);
				if (result.success) {
					successful++;
				} else {
					failed++;
				}
				
				// Xóa pipeline đã hoàn thành khỏi queue
				processingQueue.splice(completed.index, 1);
			}
		}

		console.log(`Completed all pipelines: ${successful} successful, ${failed} failed`);

		return {
			totalPipelines: PIPELINE_CONFIGS.length,
			successful,
			failed,
			results,
		};
	}

	/**
	 * Chạy một pipeline cụ thể
	 * Tự động tìm ngày xa nhất có dữ liệu (trước cutoff = 96 ngày trước) và xử lý
	 * @param config Pipeline configuration
	 */
	async runPipeline(config: PipelineConfig): Promise<PipelineResult> {
		const startTime = Date.now();
		console.log(`Running pipeline: ${config.schemaName} (table: ${config.tableName})`);

		try {
			// 0. Đảm bảo pipeline, stream và sink đã được tạo
			await this.ensurePipelineSetup(config);

			// 1. Tìm ngày xa nhất có dữ liệu (trước cutoff = 96 ngày trước)
			const targetDate = await this.findOldestDateWithData(config.tableName);
			
			if (!targetDate) {
				console.log(`  No data found in ${config.tableName}, skipping...`);
				return {
					pipelineName: config.schemaName,
					tableName: config.tableName,
					success: true,
					recordsProcessed: 0,
					timestamp: new Date().toISOString(),
				};
			}

			console.log(`  Processing oldest date: ${targetDate.toISOString().split('T')[0]}`);

			// 2. Xử lý dữ liệu theo batch: query 10k -> validate -> send -> delete -> lặp lại
			// Thay vì query tất cả vào memory rồi mới đẩy, giờ sẽ xử lý từng batch để tối ưu memory
			const recordsProcessed = await this.processDataInBatches(config, targetDate);

			const duration = Date.now() - startTime;
			console.log(`  Pipeline ${config.schemaName} completed in ${duration}ms`);

			return {
				pipelineName: config.schemaName,
				tableName: config.tableName,
				success: true,
				recordsProcessed: recordsProcessed,
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
	 * Tìm ngày xa nhất có dữ liệu trong bảng, đảm bảo giữ lại 96 ngày gần nhất
	 * @param tableName Tên bảng
	 * @returns Ngày xa nhất có dữ liệu (trước cutoff = 96 ngày trước), hoặc null nếu không tìm thấy
	 */
	private async findOldestDateWithData(tableName: string): Promise<Date | null> {
		try {
			const now = new Date();
			
			// Tính cutoff date: 96 ngày trước (để giữ lại 96 ngày gần nhất)
			const cutoffDate = new Date(now);
			cutoffDate.setDate(cutoffDate.getDate() - 96);
			cutoffDate.setHours(0, 0, 0, 0);
			const cutoffTimestamp = Math.floor(cutoffDate.getTime());

			console.log(`  Cutoff date (96 days ago): ${cutoffDate.toISOString().split('T')[0]}`);

			// Lấy created_at nhỏ nhất trong bảng, nhưng chỉ tìm các record trước cutoff
			const query = `SELECT MIN(created_at) as min_created_at FROM ${tableName} WHERE created_at < ?`;
			const result = await this.db.prepare(query).bind(cutoffTimestamp).first();

			if (!result || !(result as any).min_created_at) {
				// Không có dữ liệu nào trước cutoff, đã đủ 96 ngày gần nhất
				console.log(`  No data before cutoff date, keeping 96 most recent days`);
				return null;
			}

			const oldestTimestamp = (result as any).min_created_at;

			// Chuẩn hóa về đầu ngày
			const oldestDate = new Date(oldestTimestamp);
			oldestDate.setHours(0, 0, 0, 0);
			return oldestDate;
		} catch (error) {
			// Nếu bảng không tồn tại, trả về null
			if (error instanceof Error && error.message.includes('no such table')) {
				console.warn(`Table ${tableName} does not exist, skipping...`);
				return null;
			}
			throw error;
		}
	}

	/**
	 * Xử lý dữ liệu theo batch: query 10k từ D1 -> validate -> send vào R2 -> delete khỏi D1 -> lặp lại
	 * Tối ưu memory bằng cách không lưu tất cả records vào memory
	 * Xử lý song song nhiều batch để tăng hiệu suất
	 */
	private async processDataInBatches(config: PipelineConfig, targetDate: Date): Promise<number> {
		const batchSize = 10000; // Kích thước batch để tối ưu hiệu suất
		const concurrencyLimit = this.getConcurrencyLimit('batch');
		let totalProcessed = 0;
		let offset = 0;
		let hasMore = true;

		// Tính timestamp cho đầu và cuối ngày đích
		const startOfDay = new Date(targetDate);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(targetDate);
		endOfDay.setHours(23, 59, 59, 999);

		const startTimestamp = Math.floor(startOfDay.getTime());
		const endTimestamp = Math.floor(endOfDay.getTime());

		console.log(`  Processing data from ${config.tableName} for date ${targetDate.toISOString().split('T')[0]} (${startTimestamp} - ${endTimestamp})...`);

		try {
			// Queue để quản lý các batch đang được xử lý (map promise với batch info)
			const processingQueue: Array<{ promise: Promise<number>; offset: number }> = [];

			while (hasMore || processingQueue.length > 0) {
				// Query batch tiếp theo nếu còn data và chưa đạt giới hạn concurrency
				while (hasMore && processingQueue.length < concurrencyLimit) {
					// Query batch từ D1
					const query = `SELECT * FROM ${config.tableName} WHERE created_at >= ? AND created_at <= ? LIMIT ${batchSize} OFFSET ${offset}`;
					const result = await this.db.prepare(query).bind(startTimestamp, endTimestamp).all();

					if (!result.results || result.results.length === 0) {
						hasMore = false;
						break;
					}

					const batch = result.results as any[];
					
					if (batch.length === 0) {
						hasMore = false;
						break;
					}

					const currentOffset = offset;
					const batchLength = batch.length;

					// Tạo promise để xử lý batch này song song
					const processPromise = this.processBatch(config, targetDate, batch, currentOffset)
						.then((processed) => {
							console.log(`  Completed batch at offset ${currentOffset}: ${batchLength} records`);
							return processed;
						})
						.catch((error) => {
							console.error(`  Failed to process batch at offset ${currentOffset}:`, error);
							throw error;
						});

					processingQueue.push({ promise: processPromise, offset: currentOffset });
					offset += batch.length;

					// Nếu số bản ghi trả về ít hơn batchSize, đã lấy hết dữ liệu
					if (batch.length < batchSize) {
						hasMore = false;
					}
				}

				// Chờ một batch hoàn thành trước khi query batch tiếp theo
				if (processingQueue.length > 0) {
					// Wrap mỗi promise với index để biết promise nào hoàn thành
					const promisesWithIndex = processingQueue.map((item, index) => 
						item.promise
							.then(value => ({ status: 'fulfilled' as const, value, index }))
							.catch(reason => ({ status: 'rejected' as const, reason, index }))
					);
					
					// Chờ batch đầu tiên hoàn thành
					const completed = await Promise.race(promisesWithIndex);
					
					if (completed.status === 'fulfilled') {
						totalProcessed += completed.value;
					} else {
						// Nếu batch failed, throw error
						throw completed.reason;
					}
					
					// Xóa batch đã hoàn thành khỏi queue
					processingQueue.splice(completed.index, 1);
				}
			}

			console.log(`  Total records processed: ${totalProcessed}`);
			return totalProcessed;
		} catch (error) {
			// Nếu bảng không tồn tại, trả về 0
			if (error instanceof Error && error.message.includes('no such table')) {
				console.warn(`Table ${config.tableName} does not exist, skipping...`);
				return 0;
			}
			throw error;
		}
	}

	/**
	 * Xử lý một batch: validate -> send vào R2 -> delete khỏi D1
	 */
	private async processBatch(
		config: PipelineConfig,
		targetDate: Date,
		batch: any[],
		offset: number
	): Promise<number> {
		console.log(`  Processing batch at offset ${offset}: ${batch.length} records...`);

		// 1. Lưu record IDs để xóa sau khi đẩy thành công
		const recordIds = batch.map((record: any) => record.id).filter((id: any) => id != null);

		// 2. Validate và transform dữ liệu theo Zod schema
		const validatedRecords = this.validateRecords(batch, config.schema);

		// 3. Gửi data đến Cloudflare Pipeline HTTP endpoint
		// Data sẽ được pipeline xử lý và lưu vào R2 Data Catalog dưới dạng Iceberg table
		await this.sendToPipeline(config, validatedRecords);

		// 4. Sau khi đẩy thành công, xóa dữ liệu khỏi D1
		if (recordIds.length > 0) {
			await this.deleteBatchFromD1(config.tableName, targetDate, recordIds);
		}

		return batch.length;
	}

	/**
	 * Xóa một batch records từ D1 database (sau khi đã đẩy lên R2 thành công)
	 */
	private async deleteBatchFromD1(tableName: string, targetDate: Date, recordIds: string[]): Promise<void> {
		if (recordIds.length === 0) {
			return;
		}

		// Tính timestamp cho đầu và cuối ngày đích
		const startOfDay = new Date(targetDate);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(targetDate);
		endOfDay.setHours(23, 59, 59, 999);

		const startTimestamp = Math.floor(startOfDay.getTime());
		const endTimestamp = Math.floor(endOfDay.getTime());

		try {
			// Xóa batch records
			const placeholders = recordIds.map(() => '?').join(',');
			const query = `DELETE FROM ${tableName} WHERE id IN (${placeholders}) AND created_at >= ? AND created_at <= ?`;
			const params = [...recordIds, startTimestamp, endTimestamp];
			
			await this.db.prepare(query).bind(...params).run();
			console.log(`  Deleted ${recordIds.length} records from ${tableName}`);
		} catch (error) {
			// Nếu bảng không tồn tại, chỉ log warning
			if (error instanceof Error && error.message.includes('no such table')) {
				console.warn(`Table ${tableName} does not exist, skipping deletion...`);
				return;
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
	 * @param schemaName Tên schema
	 */
	async runPipelineByName(schemaName: string): Promise<PipelineResult> {
		const config = PIPELINE_CONFIGS.find((c) => c.schemaName === schemaName);
		if (!config) {
			throw new Error(`Pipeline config not found for schema: ${schemaName}`);
		}
		return this.runPipeline(config);
	}
}

