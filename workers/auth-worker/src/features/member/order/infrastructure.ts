import { UserDO } from '../../ws/infrastructure/UserDO';
import { createPriceApplicationService } from '../../admin/policy/application';
import { createVoucherApplicationService } from '../../admin/voucher/application';
import {
  CreateOrder,
  UpdateOrderStatus,
  CalculateOrderRequest,
  IOrderInfrastructureService,
} from './domain';
import { executeUtils } from '../../../shared/utils';
export function createOrderInfrastructureService(userDO: DurableObjectStub<UserDO>, context: any, bindingName: string): IOrderInfrastructureService {
  
  // Helper methods
  const calculateOrderTotal = async (user: any, request: CalculateOrderRequest): Promise<any[]> => {
    const priceApp = createPriceApplicationService(context, bindingName);
    const voucherApp = createVoucherApplicationService(context, bindingName);
    const orderAmount = request.items.reduce((acc, item) => acc + item.basePrice * item.quantity, 0);
    
    const results = await Promise.all(
      request.items.map(async (item) => {
        const service = await executeUtils.executeDynamicAction(userDO,
          'select', { where : { field: 'id', operator: '=', value: item.serviceId } }, 'services'
        ).then(rows => rows[0]);

        if (!service) {
          throw new Error('Service not found');
        }

        if (!service.isActive) {
          throw new Error('Service is not active');
        }
        
        if (new Date(service.expiresAt) < new Date()) {
          throw new Error('Service expired');
        }

        // Chuẩn bị các promise cho price calculation (luôn thực hiện)
        const priceData = {
            basePrice: item.basePrice,
            userId: user.id,
            serviceId: item.serviceId,
            quantity: item.quantity,
            currency: request.currency,
            userRole: user.role,
            serviceName: service.name,
            currentCalls: service.current_calls,
            maxCalls: service.max_calls
        }
        const pricePromises = [
          priceApp.calculateServicePrice(user.identifier, priceData),
          priceApp.calculateUserPrice(user.identifier, priceData)
        ];

        // Chuẩn bị các promise cho voucher calculation (chỉ khi có voucherCode)
        const voucherPromises = [];
        
        if (request.voucherCode) {
          voucherPromises.push(
            voucherApp.applyServiceVoucher(user.identifier, {            
              voucherCode: request.voucherCode,
              basePrice: item.basePrice,
              orderAmount: orderAmount,
              serviceId: item.serviceId,
              currentCalls: service.current_calls,
              userId: user.id,
              userRole: user.role
            }),
            voucherApp.applyUserVoucher(user.identifier, {
              voucherCode: request.voucherCode,
              basePrice: item.basePrice,
              orderAmount: orderAmount,
              serviceId: item.serviceId,
              currentCalls: service.current_calls,
              userId: user.id,
              userRole: user.role
            })
          );
        } else {
          // Nếu không có voucher, trả về kết quả mặc định
          voucherPromises.push(
            Promise.resolve({
              finalAmount: item.basePrice * item.quantity,
              discountAmount: 0,
              voucher: null
            }),
            Promise.resolve({
              finalAmount: item.basePrice * item.quantity,
              discountAmount: 0,
              voucher: null
            })
          );
        }

        // Thực thi tất cả promises
        const [servicePriceResult, userPriceResult, serviceVoucherResult, userVoucherResult] = await Promise.all([
          ...pricePromises,
          ...voucherPromises
        ]);

        const discounts = createDiscountsObject(servicePriceResult, userPriceResult, serviceVoucherResult, userVoucherResult);

        return {
          serviceId: item.serviceId,
          basePrice: item.basePrice,
          quantity: item.quantity,
          servicePrice: {
            finalPrice: servicePriceResult.finalPrice,
            totalDiscount: servicePriceResult.totalDiscount
          },
          userPrice: {
            finalPrice: userPriceResult.finalPrice,
            totalDiscount: userPriceResult.totalDiscount
          },
          serviceVoucher: {
            finalAmount: serviceVoucherResult.finalAmount,
            discountAmount: serviceVoucherResult.discountAmount
          },
          userVoucher: {
            finalAmount: userVoucherResult.finalAmount,
            discountAmount: userVoucherResult.discountAmount
          },
          discounts: Object.keys(discounts).length > 0 ? discounts : undefined
        };
      })
    );

    return results;
  };

  const createDiscountsObject = (servicePrice: any, userPrice: any, serviceVoucher: any, userVoucher: any) => {
    const discounts: any = {};
    
    if (servicePrice.totalDiscount > 0) {
      discounts.servicePriceDiscount = {
        amount: servicePrice.totalDiscount,
        type: 'SERVICE_PRICE',
        appliedPolicies: servicePrice.appliedPolicies
      };
    }
    
    if (userPrice.totalDiscount > 0) {
      discounts.userPriceDiscount = {
        amount: userPrice.totalDiscount,
        type: 'USER_PRICE',
        appliedPolicies: userPrice.appliedPolicies
      };
    }
    
    if (serviceVoucher.discountAmount > 0) {
      discounts.serviceVoucherDiscount = {
        amount: serviceVoucher.discountAmount,
        type: 'SERVICE_VOUCHER',
        voucher: serviceVoucher.voucher.code
      };
    }
    
    if (userVoucher.discountAmount > 0) {
      discounts.userVoucherDiscount = {
        amount: userVoucher.discountAmount,
        type: 'USER_VOUCHER',
        voucher: userVoucher.voucher.code
      };
    }

    return discounts;
  };

  const generateOrderCode = (): string => {
    const timestamp = new Date().getTime().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `ORDER_${timestamp}${random}`;
  };

  const createOrderDiscounts = async (orderItemId: string, discounts: any): Promise<void> => {
    const discountRecords = [];
    
    if (discounts?.servicePriceDiscount) {
      discountRecords.push(
        executeUtils.executeDynamicAction(userDO, 'insert', {
          orderItemId,
          discountType: discounts.servicePriceDiscount.type,
          discountAmount: discounts.servicePriceDiscount.amount,
          appliedPolicies: discounts.servicePriceDiscount.appliedPolicies
        }, 'order_discounts')
      );
    }

    if (discounts?.userPriceDiscount) {
      discountRecords.push(
        executeUtils.executeDynamicAction(userDO, 'insert', {
          orderItemId,
          discountType: discounts.userPriceDiscount.type,
          discountAmount: discounts.userPriceDiscount.amount,
          appliedPolicies: discounts.userPriceDiscount.appliedPolicies
        }, 'order_discounts')
      );
    }

    if (discounts?.serviceVoucherDiscount) {
      discountRecords.push(
        executeUtils.executeDynamicAction(userDO, 'insert', {
          orderItemId,
          discountType: discounts.serviceVoucherDiscount.type,
          discountAmount: discounts.serviceVoucherDiscount.amount,
          appliedVoucherCode: discounts.serviceVoucherDiscount.voucher
        }, 'order_discounts')
      );
    }

    if (discounts?.userVoucherDiscount) {
      discountRecords.push(
        executeUtils.executeDynamicAction(userDO, 'insert', {
          orderItemId,
          discountType: discounts.userVoucherDiscount.type,
          discountAmount: discounts.userVoucherDiscount.amount,
          appliedVoucherCode: discounts.userVoucherDiscount.voucher
        }, 'order_discounts')
      );
    }

    await Promise.all(discountRecords);
  };

  return {
    async createOrder(user: any, request: CreateOrder): Promise<any> {
      const calculationResult = await calculateOrderTotal(user, request);

      const subtotalAmount = calculationResult.reduce((total, item) => total + item.basePrice * item.quantity, 0);
      const discountAmount = calculationResult.reduce((total, item) => 
        total + item.servicePrice.totalDiscount + item.userPrice.totalDiscount + 
               item.serviceVoucher.discountAmount + item.userVoucher.discountAmount, 0);
      const finalAmount = subtotalAmount - discountAmount;

      const orderData = {
        orderCode: generateOrderCode(),
        subtotalAmount,
        discountAmount,
        finalAmount,
        currency: request.currency,
        appliedVoucherCode: request.voucherCode,
        status: 'PENDING',
        notes: request.notes,
      };

      const orderRecord = await executeUtils.executeDynamicAction(userDO, 'insert', orderData, 'orders');

      // Tạo order items và discounts
      for (const item of calculationResult) {
        const orderItem = await executeUtils.executeDynamicAction(userDO, 'insert', {
          serviceId: item.serviceId,
          basePrice: item.basePrice,
          quantity: item.quantity,
          finalAmount: item.basePrice - (item.servicePrice.totalDiscount + item.userPrice.totalDiscount + 
                     item.serviceVoucher.discountAmount + item.userVoucher.discountAmount),
          discountAmount: item.servicePrice.totalDiscount + item.userPrice.totalDiscount + 
                         item.serviceVoucher.discountAmount + item.userVoucher.discountAmount,
          orderId: orderRecord.id
        }, 'order_items');

        if (item.discounts) {
          await createOrderDiscounts(orderItem.id, item.discounts);
        }
      }

      return { id: orderRecord.id, items: calculationResult };
    },

    async getOrders(filters: any): Promise<any[]> {
      
      const orders = await executeUtils.executeDynamicAction(userDO, 'select', {
        where: { field: "status", operator: '=', value: filters.status },
        orderBy: { field: 'created_at', direction: 'DESC' },
        limit: filters.limit,
        offset: (filters.page - 1) * filters.limit
      }, 'orders')      

      const ordersWithItems = await Promise.all(
        orders.map(async (order: any) => {
          const items = await executeUtils.executeDynamicAction(userDO, 'select', {
            where: { field: "order_id", operator: '=', value: order.id }
          }, 'order_items') 
          return { ...order, items };
        })
      );

      return ordersWithItems;
    },

    async getOrderDetail(orderId: string): Promise<any> {
      const order = await executeUtils.executeDynamicAction(userDO, 'select', {
            where: { field: "id", operator: '=', value: orderId }
          }, 'orders').then((res: any) => res[0]);

      if (!order) {
        throw new Error('Order not found');
      }

      const [items, discounts] = await Promise.all([
        executeUtils.executeRepositorySelect(userDO, 'select * from order_items where order_id = ?', [orderId], "order_items"),
        executeUtils.executeRepositorySelect(userDO,
          `select od.* from order_discounts od 
           join order_items oi on od.order_item_id = oi.id 
           where oi.order_id = ?`,
          [orderId], "order_discounts"
        )
      ]);

      return { ...order, items, discounts };
    },

    async updateOrderStatus(orderId: string, request: UpdateOrderStatus): Promise<any> {
      const updateData = request.notes 
        ? { status: request.status, notes: request.notes }
        : { status: request.status };

      return await executeUtils.executeDynamicAction(userDO, 'update', { id: orderId, ...updateData }, 'orders');
    },

    async cancelOrder(orderId: string): Promise<any> {
      const updateData = { status: 'CANCELLED' };
      return await executeUtils.executeDynamicAction(userDO, 'update', { id: orderId, ...updateData }, 'orders');
    }
  };
}