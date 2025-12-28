import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createPriceInfrastructureService } from './infrastructure';
import {
  PriceCalculationRequest,
  PricePolicy,
} from './domain';

interface IPriceApplicationService {
  createPricePolicy(identifier: string, request: PricePolicy): Promise<PricePolicy>;
  updatePricePolicy(identifier: string, policyId: number, request: PricePolicy): Promise<PricePolicy>;
  getPricePolicies(identifier: string, limit: number, offset: number, status?: string): Promise<PricePolicy[]>;
  getPricePolicy(identifier: string, policyId: number): Promise<PricePolicy>;
  deletePricePolicy(identifier: string, policyId: number): Promise<void>;
  calculateServicePrice(identifier: string, request: PriceCalculationRequest): Promise<any>;
  calculateUserPrice(identifier: string, request: PriceCalculationRequest): Promise<any>;
  updatePolicyStatus(identifier: string, policyId: number, status: string): Promise<PricePolicy>;
}
export function createPriceApplicationService(c: Context, bindingName: string): IPriceApplicationService {
  const getPriceInfrastructure = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    if (!userDO) throw new Error(`Durable Object not found for identifier: ${identifier}`);
    return createPriceInfrastructureService(userDO);
  };

  return {
    async createPricePolicy(identifier: string, request: PricePolicy): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.createPricePolicy(request);
    },

    async updatePricePolicy(identifier: string, policyId: number, request: PricePolicy): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.updatePricePolicy(policyId, request);
    },

    async getPricePolicies(identifier: string, limit: number, offset: number, status?: string): Promise<any[]> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.getPricePolicies(limit, offset, status);
    },

    async getPricePolicy(identifier: string, policyId: number): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.getPricePolicy(policyId);
    },

    async deletePricePolicy(identifier: string, policyId: number): Promise<void> {
      const priceInfra = getPriceInfrastructure(identifier);
      await priceInfra.deletePricePolicy(policyId);
    },

    async calculateServicePrice(identifier: string, request: PriceCalculationRequest): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.calculateServicePrice(request);
    },

    async calculateUserPrice(identifier: string, request: PriceCalculationRequest): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      return await priceInfra.calculateUserPrice(request);
    },

    async updatePolicyStatus(identifier: string, policyId: number, status: string): Promise<any> {
      const priceInfra = getPriceInfrastructure(identifier);
      const policy = await priceInfra.updatePolicyStatus(policyId, status);
      
      return {
        id: policy.id,
        name: policy.name,
        status: policy.status,
        updatedAt: policy.updatedAt,
      };
    },
  };
}