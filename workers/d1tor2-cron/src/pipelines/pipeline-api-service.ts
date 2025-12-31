import { PipelineConfig, PipelineSchema } from './config';

/**
 * Cloudflare Pipelines API Service
 * Service này dùng để kiểm tra và tạo pipeline, stream, sink trên Cloudflare
 * Sử dụng v1 API theo: https://developers.cloudflare.com/api/resources/pipelines/
 */
export class CloudflarePipelineAPIService {
    private readonly apiBaseUrl = 'https://api.cloudflare.com/client/v4';
    private readonly accountId: string;
    private readonly apiToken: string;
    private readonly headers: HeadersInit;

    constructor(accountId: string, apiToken: string) {
        if (!accountId) {
            throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
        }
        if (!apiToken) {
            throw new Error('CLOUDFLARE_API_TOKEN is required');
        }
        this.accountId = accountId;
        this.apiToken = apiToken;
        this.headers = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
        };
    }

    /**
     * Thực hiện API request với error handling chuẩn
     */
    private async makeRequest<T>(endpoint: string, options: RequestInit): Promise<T> {
        try {
            const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => `Status: ${response.status}`);
                throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorText}`);
            }
            
            const data = await response.json() as any;
            return data.result || data;
        } catch (error) {
            console.error(`Request failed for ${endpoint}:`, error);
            throw error;
        }
    }

    /**
     * Lấy danh sách resources (pipelines, streams, sinks)
     */
    private async listResources(resourceType: 'pipelines' | 'streams' | 'sinks'): Promise<any[]> {
        const endpoint = `/accounts/${this.accountId}/pipelines/v1/${resourceType}`;
        const data = await this.makeRequest<any[]>(endpoint, {
            method: 'GET',
            headers: this.headers,
        });
        return Array.isArray(data) ? data : [];
    }

    /**
     * Kiểm tra xem resource có tồn tại không
     */
    private async resourceExists(
        resourceType: 'pipelines' | 'streams' | 'sinks',
        resourceName: string
    ): Promise<boolean> {
        try {
            const resources = await this.listResources(resourceType);
            return resources.some((resource: any) => resource.name === resourceName);
        } catch (error) {
            console.warn(`Failed to check ${resourceType} existence for ${resourceName}:`, error);
            return false;
        }
    }

    /**
     * Kiểm tra xem pipeline có tồn tại không
     */
    async pipelineExists(pipelineName: string): Promise<boolean> {
        return this.resourceExists('pipelines', pipelineName);
    }

    /**
     * List tất cả pipelines
     */
    async listPipelines(): Promise<string[]> {
        try {
            const pipelines = await this.listResources('pipelines');
            return pipelines.map((p: any) => p.name || p.id || String(p));
        } catch (error) {
            console.error('Error listing pipelines:', error);
            throw error;
        }
    }

    /**
     * Lấy thông tin stream
     */
    async getStreamInfo(streamName: string): Promise<{ 
        exists: boolean; 
        streamId?: string; 
        httpEndpoint?: string;
        stream?: any;
    }> {
        try {
            const streams = await this.listResources('streams');
            const stream = streams.find((s: any) => s.name === streamName);
            
            if (!stream) {
                return { exists: false };
            }

            return {
                exists: true,
                streamId: stream.id,
                httpEndpoint: stream.http?.endpoint || stream.http_endpoint,
                stream
            };
        } catch (error) {
            console.error(`Error getting stream info for ${streamName}:`, error);
            return { exists: false };
        }
    }

    /**
     * Kiểm tra xem sink có tồn tại không
     */
    async sinkExists(sinkName: string): Promise<boolean> {
        return this.resourceExists('sinks', sinkName);
    }

    /**
     * Tạo stream với schema
     */
    async createStream(streamName: string, schema: PipelineSchema): Promise<string> {
        const endpoint = `/accounts/${this.accountId}/pipelines/v1/streams`;
        
        try {
            const data = await this.makeRequest<any>(endpoint, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    name: streamName,
                    schema: schema,
                    http: { enabled: true },
                }),
            });

            const streamId = data?.id;
            if (!streamId) {
                throw new Error(`No stream ID returned for ${streamName}`);
            }

            console.log(`Created stream: ${streamName} with ID: ${streamId}`);
            return streamId;
        } catch (error: any) {
            // Nếu stream đã tồn tại, lấy stream ID
            if (error.message.includes('already exists') || error.message.includes('409')) {
                console.log(`Stream ${streamName} already exists, retrieving info`);
                const streamInfo = await this.getStreamInfo(streamName);
                if (streamInfo.exists && streamInfo.streamId) {
                    return streamInfo.streamId;
                }
            }
            throw error;
        }
    }

    /**
     * Tạo sink với R2 Data Catalog
     */
    async createSink(
        sinkName: string, 
        bucketName: string, 
        namespace: string, 
        tableName: string
    ): Promise<void> {
        const endpoint = `/accounts/${this.accountId}/pipelines/v1/sinks`;
        
        try {
            await this.makeRequest(endpoint, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    name: sinkName,
                    type: 'r2',
                    config: {
                        bucket: bucketName,
                        namespace: namespace,
                        table: tableName,
                        compression: 'zstd',
                        roll_size_mb: 100,
                        roll_time_seconds: 10,
                    },
                }),
            });

            console.log(`Created sink: ${sinkName}`);
        } catch (error: any) {
            // Nếu sink đã tồn tại, bỏ qua
            if (error.message.includes('already exists') || error.message.includes('409')) {
                console.log(`Sink ${sinkName} already exists`);
                return;
            }
            throw error;
        }
    }

    /**
     * Tạo pipeline kết nối stream và sink
     */
    async createPipeline(
        pipelineName: string, 
        streamName: string, 
        sinkName: string, 
        tableName: string
    ): Promise<string> {
        const endpoint = `/accounts/${this.accountId}/pipelines/v1/pipelines`;
        const sqlTransformation = `INSERT INTO ${sinkName} SELECT * FROM ${streamName};`;
        
        try {
            await this.makeRequest(endpoint, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    name: pipelineName,
                    sql: sqlTransformation,
                    stream: { name: streamName },
                    sink: { name: sinkName },
                }),
            });

            console.log(`Created pipeline: ${pipelineName}`);
            
            // Lấy endpoint từ stream
            const streamInfo = await this.getStreamInfo(streamName);
            if (streamInfo.httpEndpoint) {
                console.log(`Stream endpoint: ${streamInfo.httpEndpoint}`);
                return streamInfo.httpEndpoint;
            }
            
            return '';
        } catch (error: any) {
            // Nếu pipeline đã tồn tại, lấy endpoint từ stream
            if (error.message.includes('already exists') || error.message.includes('409')) {
                console.log(`Pipeline ${pipelineName} already exists`);
                return this.getPipelineEndpoint(streamName);
            }
            throw error;
        }
    }

    /**
     * Lấy HTTP endpoint của pipeline (từ stream)
     */
    async getPipelineEndpoint(streamName: string): Promise<string> {
        try {
            const streamInfo = await this.getStreamInfo(streamName);
            if (streamInfo.httpEndpoint) {
                return streamInfo.httpEndpoint;
            }
            
            // Fallback: tạo endpoint từ stream ID
            if (streamInfo.streamId) {
                return `https://${streamInfo.streamId}.ingest.cloudflare.com`;
            }
            
            return '';
        } catch (error) {
            console.error(`Error getting endpoint for stream ${streamName}:`, error);
            return '';
        }
    }

    /**
     * Đảm bảo pipeline, stream và sink tồn tại cho schema
     */
    async ensurePipelineExists(config: PipelineConfig): Promise<string> {
        const pipelineName = config.tableName;
        const streamName = `${pipelineName}_stream`;
        const sinkName = `${pipelineName}_sink`;

        console.log(`Ensuring pipeline exists for schema ${config.schemaName}, table: ${pipelineName}`);

        // Kiểm tra pipeline đã tồn tại chưa
        const pipelineExists = await this.pipelineExists(pipelineName);
        
        if (pipelineExists) {
            console.log(`Pipeline ${pipelineName} already exists`);
        } else {
            console.log(`Creating new pipeline infrastructure for ${pipelineName}`);
        }

        // 1. Đảm bảo sink tồn tại
        const sinkExists = await this.sinkExists(sinkName);
        if (!sinkExists) {
            console.log(`Creating sink: ${sinkName}`);
            await this.createSink(sinkName, config.r2BucketName, config.namespace, config.tableName);
        } else {
            console.log(`Sink ${sinkName} already exists`);
        }

        // 2. Đảm bảo stream tồn tại và lấy stream ID
        let streamInfo = await this.getStreamInfo(streamName);
        let streamId = streamInfo.streamId;

        if (!streamInfo.exists) {
            console.log(`Creating stream: ${streamName}`);
            streamId = await this.createStream(streamName, config.pipelineSchema);
        } else if (!streamId) {
            console.log(`Stream ${streamName} exists but no ID found, retrieving...`);
            streamInfo = await this.getStreamInfo(streamName);
            streamId = streamInfo.streamId;
        }

        // 3. Đảm bảo pipeline tồn tại (chỉ tạo nếu chưa tồn tại)
        if (!pipelineExists) {
            console.log(`Creating pipeline: ${pipelineName}`);
            await this.createPipeline(pipelineName, streamName, sinkName, config.tableName);
        }

        // 4. Lấy endpoint cuối cùng
        const endpoint = await this.getPipelineEndpoint(streamName);
        
        if (!endpoint) {
            throw new Error(`Failed to get endpoint for schema ${config.schemaName}`);
        }

        console.log(`✓ Pipeline setup complete for ${config.schemaName}`);
        console.log(`  Stream ID: ${streamId || 'unknown'}`);
        console.log(`  Endpoint: ${endpoint}`);

        return endpoint;
    }

    /**
     * Kiểm tra xem pipeline đã tồn tại cho schema chưa
     */
    async pipelineExistsForSchema(schemaName: string, tableName: string): Promise<boolean> {
        return this.pipelineExists(tableName);
    }
}