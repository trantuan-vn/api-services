import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  Voucher,
  ApplyVoucher,
  ValidateVoucherRequest,
  IVoucherInfrastructureService,
} from './domain';
import { executeUtils } from '../../../shared/utils';
export function createVoucherInfrastructureService(userDO: DurableObjectStub<UserDO>): IVoucherInfrastructureService {  

  // Helper methods
  const isVoucherApplicable = (voucher: any, request: any, targetType: 'SERVICE' | 'USER' ): boolean => {

    // Check target type
    if (targetType === 'SERVICE' && voucher.targetType !== 'SERVICE' && voucher.targetType !== 'BOTH') {
      throw new Error(`TargetType must be SERVICE or BOTH. ${voucher.targetType} for voucher ${voucher.code} is not applicable for this service`);
    }

    if (targetType === 'USER' && voucher.targetType !== 'USER' && voucher.targetType !== 'BOTH') {
      throw new Error(`TargetType must be USER or BOTH. ${voucher.targetType} for voucher ${voucher.code} is not applicable for this user`);
    }

    // Check status
    if (voucher.status !== 'ACTIVE') {
      throw new Error(`Voucher for ${voucher.code} is not active.`);
    }

    // Check date validity
    if (new Date(voucher.expiresAt) < new Date()) {
      throw new Error(`Voucher for ${voucher.code} has expired.`);
    }

    // Check usage limit
    if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) {
      throw new Error(`Voucher for ${voucher.code} has reached its usage limit.`);
    }

    // Check minimum order amount
    if (voucher.minOrderAmount && request.orderAmount < voucher.minOrderAmount) {
      throw new Error(`Voucher for ${voucher.code} requires a minimum order amount of ${voucher.minOrderAmount}.`);
    }

    // Service-specific checks
    if (targetType === 'SERVICE' && request.serviceId) {
      if (voucher.applicableServices && voucher.applicableServices.length > 0 && !voucher.applicableServices.includes(request.serviceId)) {
        throw new Error(`Voucher for ${voucher.code} is not applicable for service ${request.serviceId}.`);
      }
    }

    // User-specific checks
    if (targetType === 'USER') {
      if (voucher.applicableUsers && 
          voucher.applicableUsers.length > 0 && 
          request.userId && 
          !voucher.applicableUsers.includes(request.userId)) {
        //throw new Error(`Voucher for ${voucher.code} is not applicable for user ${request.userId}.`);
        throw new Error(`Voucher for ${voucher.code} is not applicable for user ${request.userId}. voucher.applicableUsers?.length is ${voucher.applicableUsers.length}, request.userId is ${request.userId}, voucher.applicableUsers.includes(request.userId) is ${voucher.applicableUsers.includes(request.userId)}, voucher.applicableUsers is ${Array.isArray(voucher.applicableUsers)}, `);
      }

      if (voucher.userRoles && voucher.userRoles.length>0 && request.userRole && !voucher.userRoles.includes(request.userRole)) {
        throw new Error(`Voucher for ${voucher.code} is not applicable for user role ${request.userRole}.`);
      }
    }

    // Usage-based conditions
    if (voucher.conditions && voucher.type === 'USAGE_BASED') {
      const { minUsage, maxCalls } = voucher.conditions;
      const currentCalls = request.currentCalls || 0;
      
      if (minUsage !== undefined && currentCalls < minUsage) {
        throw new Error(`Voucher for ${voucher.code} requires a minimum usage of ${minUsage}. Current usage is ${currentCalls}.`);
      }
      
      if (maxCalls !== undefined && currentCalls > maxCalls) {
        throw new Error(`Voucher for ${voucher.code} requires a maximum usage of ${maxCalls}. Current usage is ${currentCalls}.`);
      }
    }

    return true;
  };

  const calculateDiscount = (voucher: any, basePrice: number, currentCalls: number): number => {
    let discount = 0;

    switch (voucher.type) {
      case 'PERCENTAGE':
        discount = basePrice * (voucher.discountValue / 100);
        if (voucher.maxDiscountAmount && discount > voucher.maxDiscountAmount) {
          discount = voucher.maxDiscountAmount;
        }
        break;

      case 'FIXED_AMOUNT':
        discount = voucher.discountValue;
        break;

      case 'USAGE_BASED':
        discount = calculateUsageBasedDiscount(voucher, basePrice, currentCalls);
        break;

      case 'TIERED':
        discount = calculateTieredDiscount(voucher, basePrice);
        break;
    }

    return Math.min(discount, basePrice);
  };

  const calculateUsageBasedDiscount = (voucher: any, basePrice: number, currentCalls: number): number => {
    if (voucher.conditions?.minUsage && voucher.conditions?.maxCalls) {
      const { minUsage, maxCalls } = voucher.conditions;
      
      if (currentCalls >= minUsage && currentCalls <= maxCalls) {
        const usageRange = maxCalls - minUsage;
        const currentPosition = currentCalls - minUsage;
        const discountMultiplier = currentPosition / usageRange;
        
        return (basePrice * (voucher.discountValue * discountMultiplier)) / 100;
      }
    }
    
    return voucher.discountValue;
  };

  const calculateTieredDiscount = (voucher: any, basePrice: number): number => {
    const tiers = voucher.conditions?.tiers || [];
    for (const tier of tiers.reverse()) {
      if (basePrice >= tier.minAmount) {
        return tier.type === 'PERCENTAGE' 
          ? basePrice * (tier.value / 100) 
          : tier.value;
      }
    }
    return 0;
  };

  return {
    async createVoucher(request: Partial<Voucher>): Promise<any> {
      // Check if code already exists
      const existingVouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "code", operator: '=', value: request.code },
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')      
      
      if (existingVouchers.length > 0) {
        throw new Error('Voucher code already exists');
      }
      return await executeUtils.executeDynamicAction(userDO, 'insert', request, 'vouchers');
    },

    async applyServiceVoucher(request: ApplyVoucher): Promise<any> {
      const { voucherCode, basePrice, serviceId } = request;
      
      // Find voucher by code
      const vouchers = await executeUtils.executeDynamicAction(userDO,
        'select', 
        { 
          where: { field: 'code', operator: '=', value: voucherCode.toUpperCase() } 
        }, 
        'vouchers'
      );

      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }
      
      const voucher = vouchers[0];

      // Validate voucher
      if (!isVoucherApplicable(voucher, request, 'SERVICE')) {
        throw new Error('Voucher is not applicable for this service');
      }

      // Calculate discount
      const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

      // Update voucher usage count
      await executeUtils.executeDynamicAction(userDO, 'update', {
        id: voucher.id,
        data: { usedCount: voucher.usedCount + 1 }
      }, 'vouchers');

      return {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
        },
        serviceId: serviceId,
        originalAmount: basePrice,
        discountAmount: discountAmount,
        finalAmount: basePrice - discountAmount,
      };
    },

    async applyUserVoucher(request: ApplyVoucher): Promise<any> {
      const { voucherCode, basePrice, userId } = request;
      const vouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "code", operator: '=', value: voucherCode.toUpperCase() },
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')      
      
      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }

      const voucher = vouchers[0];

      // Validate voucher
      if (!isVoucherApplicable(voucher, request, 'USER')) {
        throw new Error('Voucher is not applicable for this user');
      }

      // Calculate discount
      const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

      // Update voucher usage count
      await executeUtils.executeDynamicAction(userDO, 'update', {
        id: voucher.id,
        data: { usedCount: voucher.usedCount + 1 }
      }, 'vouchers');

      return {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
        },
        userId: userId,
        originalAmount: basePrice,
        discountAmount: discountAmount,
        finalAmount: basePrice - discountAmount,
      };
    },

    async getVouchers(status?: string, targetType?: string): Promise<any[]> {      
      return await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "status", operator: '=', value: status },
          { field: "targetType", operator: '=', value: targetType }
        ],
        orderBy: { field: 'createdAt', direction: 'DESC' }
      }, 'vouchers')      
    },

    async getVoucherByCode(voucherCode: string): Promise<any> {
      const vouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "code", operator: '=', value: voucherCode.toUpperCase() },
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')             
      
      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }
      
      return vouchers[0];
    },

    async validateServiceVoucher(request: ValidateVoucherRequest): Promise<any> {
      const { voucherCode } = request;
      const vouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "code", operator: '=', value: voucherCode.toUpperCase() },
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')       
      
      
      if (vouchers.length === 0) {
        return { isValid: false, errorMessage: 'Voucher not found' };
      }

      const voucher = vouchers[0];
      const isValid = isVoucherApplicable(voucher, request, 'SERVICE');

      return {
        isValid,
        errorMessage: isValid ? undefined : 'Voucher is not applicable for this service',
        voucher: isValid ? {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
          discountValue: voucher.discountValue,
          maxDiscountAmount: voucher.maxDiscountAmount,
        } : undefined
      };
    },

    async validateUserVoucher(request: ValidateVoucherRequest): Promise<any> {
      const { voucherCode } = request;
      const vouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "code", operator: '=', value: voucherCode.toUpperCase() },
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')       
      
      if (vouchers.length === 0) {
        return { isValid: false, errorMessage: 'Voucher not found' };
      }

      const voucher = vouchers[0];
      const isValid = isVoucherApplicable(voucher, request, 'USER');

      return {
        isValid,
        errorMessage: isValid ? undefined : 'Voucher is not applicable for this user',
        voucher: isValid ? {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
          discountValue: voucher.discountValue,
          maxDiscountAmount: voucher.maxDiscountAmount,
        } : undefined
      };
    },

    async updateVoucherStatus(voucherId: string, status: string): Promise<any> {
      // Update voucher
      return await executeUtils.executeDynamicAction(userDO, 'update', {
        id: voucherId,
        data: { 
          status,
        }
      }, 'vouchers');
    },

    async getAvailableServiceVouchers(serviceId?: string, basePrice?: number): Promise<any[]> {
      let sql = `
        select * from vouchers 
        where status = 'ACTIVE' 
        and (usageLimit is null or usedCount < usageLimit)
        and targetType in ('SERVICE', 'BOTH')
      `;
      const params: any[] = [];

      if (serviceId) {
        sql += ` and (applicableServices = '[]' or EXISTS (
                                                  SELECT 1 
                                                  FROM json_each(applicableServices) 
                                                  WHERE value = ?
                                              )
                      )`;
        params.push(`"${serviceId}"`);
      }

      const vouchers = await executeUtils.executeRepositorySelect(userDO, sql, params, 'vouchers');
      
      // Filter by base price if provided
      if (basePrice !== undefined) {
        return vouchers.filter(voucher => 
          !voucher.minOrderAmount || basePrice >= voucher.minOrderAmount
        );
      }

      return vouchers;
    },

    async getAvailableUserVouchers(userId?: string, userRole?: string, basePrice?: number): Promise<any[]> {
      const vouchers = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: [
          { field: "status", operator: '=', value: 'ACTIVE' }
        ]
      }, 'vouchers')
            
      // Filter by user-specific conditions
      return vouchers
        .filter((voucher: any) => 
            ((!voucher.usageLimit || voucher.usedCount < voucher.usageLimit) 
              && voucher.targetType in ['SERVICE', 'BOTH']))
        .filter( (voucher: any) => {
          if (voucher.applicableUsers?.length 
              && userId 
              && !voucher.applicableUsers.includes(userId)) {
            return false;
          }

          if (voucher.userRoles?.length && userRole && !voucher.userRoles.includes(userRole)) {
            return false;
          }

          if (basePrice !== undefined && voucher.minOrderAmount && basePrice < voucher.minOrderAmount) {
            return false;
          }

          return true;
        });
    },
  };
}