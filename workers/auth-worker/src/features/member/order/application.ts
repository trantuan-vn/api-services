import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createOrderInfrastructureService } from './infrastructure';
import { CreateOrder, UpdateOrderStatus } from './domain';

export interface IOrderApplicationService {
  createOrder(user: any, request: CreateOrder): Promise<any>;
  getOrders(identifier: string, filters: any): Promise<any[]>;
  getOrderDetail(identifier: string, orderId: string): Promise<any>;
  updateOrderStatus(identifier: string, orderId: string, request: UpdateOrderStatus): Promise<any>;
  cancelOrder(identifier: string, orderId: string): Promise<any>;
}

export function createOrderApplicationService(c: Context, bindingName: string): IOrderApplicationService {
  const getOrderInfrastructure = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    return createOrderInfrastructureService(userDO, c, bindingName);
  };

  return {
    async createOrder(user: any, request: CreateOrder): Promise<any> {
      const orderInfra = getOrderInfrastructure(user.identifier);
      return await orderInfra.createOrder(user, request);
    },

    async getOrders(identifier: string, filters: any): Promise<any[]> {
      const orderInfra = getOrderInfrastructure(identifier);
      return await orderInfra.getOrders(filters);
    },

    async getOrderDetail(identifier: string, orderId: string): Promise<any> {
      const orderInfra = getOrderInfrastructure(identifier);
      return await orderInfra.getOrderDetail(orderId);
    },

    async updateOrderStatus(identifier: string, orderId: string, request: UpdateOrderStatus): Promise<any> {
      const orderInfra = getOrderInfrastructure(identifier);
      return await orderInfra.updateOrderStatus(orderId, request);
    },

    async cancelOrder(identifier: string, orderId: string): Promise<any> {
      const orderInfra = getOrderInfrastructure(identifier);
      return await orderInfra.cancelOrder(orderId);
    }
  };
}