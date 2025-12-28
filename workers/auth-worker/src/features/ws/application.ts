import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from './infrastructure/UserDO';
import { BroadcastServiceDO } from './infrastructure/BroadcastServiceDO';

interface IWebsocketApplicationService {
    connectWebSocketUseCase: (identifier: string) => Promise<Response>;
    broadcastMessageUseCase: (request: Request) => Promise<Response>;
}

export function createWebsocketApplicationService(c: Context, bindingName: string): IWebsocketApplicationService {
    return {
        connectWebSocketUseCase: async (identifier: string) => {
            const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;;
            const request = c.req.raw;
            const response = await userDO.fetch(request);
            if (response.status !== 500) {
                throw new Error(`Failed to connect WebSocket with identifier (${identifier})`);
            }
            return response;
        },
        broadcastMessageUseCase: async (request: Request) => {
            const broadcastServiceDO = getIdFromName(c, "global", "BROADCAST_SERVICE_DO")  as DurableObjectStub<BroadcastServiceDO>;
            const response = await broadcastServiceDO.fetch(request);
            if (response.status !== 500) {
                throw new Error(`Failed to broadcast message, status: ${response.status}, body: ${await response.text()}, url: ${request.url}, method: ${request.method}`);
            }
            return response;
        }
    }
}