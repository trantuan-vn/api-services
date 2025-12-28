import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  PricePolicy,
  PriceCalculationRequest,
  IPriceInfrastructureService,
} from './domain';
import { executeUtils } from '../../../shared/utils';
export function createPriceInfrastructureService(userDO: DurableObjectStub<UserDO>): IPriceInfrastructureService {
  // Helper methods
  const isPolicyApplicable = (policy: any, request: PriceCalculationRequest): boolean => {
    const conditions = policy.conditions || {};
    // check status
    if (policy.status !== 'ACTIVE') {
      throw new Error(`Policy ${policy.name} is not active.`);
    }
    // Check date validity
    if (new Date(policy.expiresAt) < new Date()) {
      throw new Error(`Policy ${policy.name} has expired.`);
    }

    // Check target specific conditions
    if (policy.targetType === 'SERVICE') {
      if (policy.targetIds && policy.targetIds.length>0 && !policy.targetIds.includes(request.serviceId)) {
        throw new Error(`Service ${request.serviceId} is not applicable for this policy (${policy.name}), policy.targetIds is ${Array.isArray(policy.targetIds)}, policy.targetIds[0] is ${typeof policy.targetIds[0] === 'string'} , request.serviceId is ${typeof request.serviceId === 'string' }, policy.targetIds.includes(request.serviceId) is ${policy.targetIds.includes(request.serviceId)}, policy.targetIds is ${policy.targetIds}`);
      }
    }

    if (policy.targetType === 'USER') {
      if (policy.targetIds && policy.targetIds.length>0 && !policy.targetIds.includes(request.userId)) {
        throw new Error(`User ${request.userId} is not applicable for this policy (${policy.name})`);
      }
    }

    // Check user role
    if (policy.targetType === 'USER' && conditions.userRoles) {
      if (conditions.userRoles.length>0 && !conditions.userRoles.includes(request.userRole)) {
        throw new Error(`User role ${request.userRole} is not applicable for this policy (${policy.name})`);
      }
    }

    // Check usage conditions
    if (policy.type === 'USAGE_BASED' && conditions.maxCalls) {
      if ((request.currentCalls ?? 0) >= conditions.maxCalls) {
        throw new Error(`Usage limit has been reached for this policy (${policy.name})`);
      }
    }

    // Check minimum quantity
    if (conditions.minQuantity && request.quantity) {
      if (request.quantity < conditions.minQuantity) {
        throw new Error(`Minimum quantity is ${conditions.minQuantity} for this policy (${policy.name}).`);
      }
    }


    return true;
  };

  const calculateDiscount = (policy: any, currentPrice: number, request: PriceCalculationRequest): number => {
    switch (policy.type) {
      case 'PERCENTAGE':
        return currentPrice * (policy.value / 100);
      case 'FIXED_AMOUNT':
        return policy.value;
      case 'TIERED':
        return calculateTieredDiscount(policy, currentPrice, request);
      case 'USAGE_BASED':
        return calculateUsageBasedDiscount(policy, request);
      default:
        return 0;
    }
  };

  const calculateTieredDiscount = (policy: any, currentPrice: number, request: any): number => {
    const tiers = [...(policy.conditions?.tiers || [])].sort((a, b) => 
      (a.minAmount || a.minUsage || 0) - (b.minAmount || b.minUsage || 0)
    );
    
    // Tìm tier phù hợp (tier cao nhất mà điều kiện thỏa mãn)
    let applicableTier = null;
    for (const tier of tiers) {
      if (tier.minAmount && currentPrice >= tier.minAmount) {
        applicableTier = tier;
      } else if (tier.minUsage && 'currentCalls' in request && (request.currentCalls ?? 0) >= tier.minUsage) {
        applicableTier = tier;
      }
    }
    
    if (!applicableTier) return 0;
    
    return applicableTier.type === 'PERCENTAGE' 
      ? currentPrice * (applicableTier.value / 100) 
      : applicableTier.value;
  };

  const calculateUsageBasedDiscount = (policy: any, request: PriceCalculationRequest): number => {
    if (!('currentCalls' in request)) return 0;
    
    const conditions = policy.conditions || {};
    const currentCalls = request.currentCalls || 0;
    const maxCalls = conditions.maxCalls || 1;
    
    if (conditions.usagePercentage && (currentCalls / maxCalls) >= conditions.usagePercentage) {
      return policy.value;
    }
    
    return 0;
  };

  const calculatePrice = async (request: PriceCalculationRequest, targetType: 'SERVICE' | 'USER') => {
    const activePolicies = await executeUtils.executeDynamicAction(userDO,
      'select', { 
        where: { field: 'targetType', operator: '=', value: targetType },
        orderBy: { field: 'priority', direction: 'DESC' } 
      }, 'price_policies'
    );


    let finalPrice = request.basePrice;
    let totalDiscount = 0;
    const appliedPolicies = [];

    for (const policy of activePolicies) {
      if (isPolicyApplicable(policy, request)) {
        const discount = calculateDiscount(policy, finalPrice, request);
        finalPrice = Math.max(0, finalPrice - discount);
        totalDiscount += discount;
        
        appliedPolicies.push({
          policyId: policy.id,
          policyName: policy.name,
          discount,
          type: policy.type
        });
      }
    }

    return {
      basePrice: request.basePrice,
      finalPrice,
      totalDiscount,
      appliedPolicies,
      currency: request.currency || 'VND',
      [targetType === 'SERVICE' ? 'serviceId' : 'userId']: targetType === 'SERVICE' 
        ? request.serviceId 
        : request.userId
    };
  };

  return {
    createPricePolicy: (request: Partial<PricePolicy>) => 
      executeUtils.executeDynamicAction(userDO, 'insert', request, 'price_policies'),

    updatePricePolicy: (policyId: number, request: Partial<PricePolicy>) => 
      executeUtils.executeDynamicAction(userDO, 'update', { id: policyId, ...request }, 'price_policies'),

    getPricePolicies: (limit: number, offset: number, status?: string) => 
      executeUtils.executeDynamicAction(userDO, 'select', {
        where: { field: "status", operator: '=', value: status ? status : "status" },
        orderBy: { field: 'priority', direction: 'DESC' },
        limit,
        offset
      }, 'price_policies'),

    getPricePolicy: (policyId: number) => 
      executeUtils.executeDynamicAction(userDO, 'select', {
        where: { field: "id", operator: '=', value: policyId }
      }, 'price_policies'),

    deletePricePolicy: (policyId: number) => 
      executeUtils.executeDynamicAction(userDO, 'delete', { id: policyId }, 'price_policies'),

    updatePolicyStatus: (policyId: number, status: string) => 
      executeUtils.executeDynamicAction(userDO, 'update', { id: policyId, status: status}, 'price_policies'),

    calculateServicePrice: (request: PriceCalculationRequest) => 
      calculatePrice(request, 'SERVICE'),

    calculateUserPrice: (request: PriceCalculationRequest) => 
      calculatePrice(request, 'USER'),
  };
}