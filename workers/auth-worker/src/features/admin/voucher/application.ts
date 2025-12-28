import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createVoucherInfrastructureService } from './infrastructure';
import {
  ApplyVoucher,
  ValidateVoucherRequest,
  Voucher,
} from './domain';

export interface IVoucherApplicationService {
  createVoucher(identifier: string, request: Voucher): Promise<Voucher>;
  applyServiceVoucher(identifier: string, request: ApplyVoucher): Promise<any>;
  applyUserVoucher(identifier: string, request: ApplyVoucher): Promise<any>;
  getVouchers(identifier: string, status?: string, targetType?: string): Promise<Voucher[]>;
  getVoucherByCode(identifier: string, voucherCode: string): Promise<Voucher>;
  validateServiceVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any>;
  validateUserVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any>;
  updateVoucherStatus(identifier: string, voucherId: string, status: string): Promise<Voucher>;
  getAvailableServiceVouchers(identifier: string, serviceId?: string, basePrice?: number): Promise<Voucher[]>;
  getAvailableUserVouchers(identifier: string, userId?: string, userRole?: string, basePrice?: number): Promise<Voucher[]>;
}

export function createVoucherApplicationService(c: Context, bindingName: string): IVoucherApplicationService {
  const getVoucherInfrastructure = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    if (!userDO) throw new Error(`Durable Object not found for identifier: ${identifier}`);
    return createVoucherInfrastructureService(userDO);
  };

  return {
    async createVoucher(identifier: string, request: Voucher): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      const voucher = await voucherInfra.createVoucher(request);
      
      return {
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
        maxDiscountAmount: voucher.maxDiscountAmount,
        usageLimit: voucher.usageLimit,
        usedCount: voucher.usedCount,
        targetType: voucher.targetType,
        applicableServices: voucher.applicableServices,
        applicableUsers: voucher.applicableUsers,
        userRoles: voucher.userRoles,
        expiresAt: voucher.expiresAt,
        status: voucher.status,
        createdAt: voucher.createdAt,
      };
    },

    async applyServiceVoucher(identifier: string, request: ApplyVoucher): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.applyServiceVoucher(request);
    },

    async applyUserVoucher(identifier: string, request: ApplyVoucher): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.applyUserVoucher(request);
    },

    async getVouchers(identifier: string, status?: string, targetType?: string): Promise<any[]> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      const vouchers = await voucherInfra.getVouchers(status, targetType);
      
      return vouchers.map(voucher => ({
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        usedCount: voucher.usedCount,
        usageLimit: voucher.usageLimit,
        targetType: voucher.targetType,
        status: voucher.status,
        expiresAt: voucher.expiresAt,
      }));
    },

    async getVoucherByCode(identifier: string, voucherCode: string): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      const voucher = await voucherInfra.getVoucherByCode(voucherCode);
      
      return {
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
        maxDiscountAmount: voucher.maxDiscountAmount,
        usageLimit: voucher.usageLimit,
        usedCount: voucher.usedCount,
        targetType: voucher.targetType,
        applicableServices: voucher.applicableServices,
        applicableUsers: voucher.applicableUsers,
        userRoles: voucher.userRoles,
        expiresAt: voucher.expiresAt,
        status: voucher.status,
      };
    },

    async validateServiceVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.validateServiceVoucher(request);
    },

    async validateUserVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.validateUserVoucher(request);
    },

    async updateVoucherStatus(identifier: string, voucherId: string, status: string): Promise<any> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      const voucher = await voucherInfra.updateVoucherStatus(voucherId, status);
      
      return {
        id: voucher.id,
        code: voucher.code,
        status: voucher.status,
        updatedAt: voucher.updatedAt,
      };
    },

    async getAvailableServiceVouchers(identifier: string, serviceId?: string, basePrice?: number): Promise<any[]> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.getAvailableServiceVouchers(serviceId, basePrice);
    },

    async getAvailableUserVouchers(identifier: string, userId?: string, userRole?: string, basePrice?: number): Promise<any[]> {
      const voucherInfra = getVoucherInfrastructure(identifier);
      return await voucherInfra.getAvailableUserVouchers(userId, userRole, basePrice);
    },
  };
}