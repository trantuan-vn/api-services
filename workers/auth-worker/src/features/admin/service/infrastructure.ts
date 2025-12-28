import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  Service,
  IServiceInfrastructureService,
} from './domain';
import { executeUtils } from '../../../shared/utils';
export function createServiceInfrastructureService(userDO: DurableObjectStub<UserDO>): IServiceInfrastructureService {

  return {
    async registerService(request: Service): Promise<any> {
      console.log(`Registering service: ${JSON.stringify(request)}`);
      return await executeUtils.executeDynamicAction(userDO, 'insert', request, 'services');
    },

    async getUserServices(): Promise<any[]> {
      return await executeUtils.executeDynamicAction(userDO, 'select', {
        where: { field: "isActive", operator: '=', value: 1 },
        orderBy: { field: 'createdAt', direction: 'DESC' }
      }, 'services')
    },

    async cancelService(serviceId: string): Promise<void> {
      await executeUtils.executeDynamicAction(userDO, 'update', { id: serviceId, isActive: false }, 'services');
    },

    async getServiceUsage(serviceId: string, days: number = 30): Promise<any[]> {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      return await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "serviceId", operator: '=', value: serviceId },
          { field: "createdAt", operator: '>=', value: cutoff }
        ],
        orderBy: { field: 'createdAt', direction: 'DESC' }
      }, 'service_usages')      
    },
  };
}