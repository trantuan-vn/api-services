import { UserDO } from '../../ws/infrastructure/UserDO';
import { 
  IVNPayService, 
  ICryptoService,
  CreatePayment,
  PaymentQuery,
  CreateRefund,
  QueryDRResult,
  RefundResult,
  PaymentSchema,
  RefundSchema,
  VNPayReturn,
  PaymentResult
} from './domain';

import { config } from './config';
import { paymentUtils, cryptoUtils } from './utils';
import { VNPAY_CONSTANTS, PAYMENT_STATUS, ORDER_STATUS, PAYMENT_ERROR_MESSAGES } from './constant';

import { executeUtils } from '../../../shared/utils';
export function createVNPayService(userDO: DurableObjectStub<UserDO>): IVNPayService {
  
  // Helper methods
  const getServiceUpdates = async (orderId: number, operation: 'add' | 'subtract'): Promise<Array<{sql: string, params: any[]}>> => {
    const orderItems = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId], "order_items"
    );
    let operations: Array<{sql: string, params: any[]}> = [];

    for (const item of orderItems) {
      const services = await executeUtils.executeRepositorySelect(userDO,
        'SELECT * FROM services WHERE id = ? AND isActive = ?',
        [item.serviceId, 1], "services"
      );
      
      if (services.length === 0) {
        throw new Error(PAYMENT_ERROR_MESSAGES.SERVICE_NOT_FOUND.replace('${item.serviceId}', item.serviceId));
      }

      const service = services[0];
      const newMaxCalls = operation === 'add' 
        ? service.maxCalls + item.quantity
        : service.maxCalls - item.quantity;
      
      operations.push({
        sql: 'UPDATE services SET maxCalls = ? WHERE id = ?',
        params: [newMaxCalls, service.id]
      })
    }
    return operations;
  };

  const validatePayment = async (paymentId: number, expectedAmount: number): Promise<number> => {
    const payment = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [paymentId], "payments"
    );

    if (payment.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    
    if (payment[0].status !== PAYMENT_STATUS.PENDING) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM orders WHERE id = ?',
      [payment[0].orderId], "orders"
    );

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const order = orders[0];
    if (order.finalAmount !== expectedAmount) {
      throw new Error(PAYMENT_ERROR_MESSAGES.INVALID_AMOUNT);
    }
    return order.id;
  };

  const processPaymentTransaction = async (
    paymentId: number, 
    orderId: number, 
    params: VNPayReturn
  ): Promise<void> => {
    const newPaymentStatus = (params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00')
      ? PAYMENT_STATUS.COMPLETED 
      : PAYMENT_STATUS.FAILED;
    
    let updates: Array<{sql: string, params: any[]}>= [];
    updates.push({
      sql: 'UPDATE payments SET status = ?, queueStatus = ? WHERE id = ?',
      params: [newPaymentStatus, 'pending', paymentId]
    });
    
    if (newPaymentStatus === PAYMENT_STATUS.COMPLETED) {
      updates = await getServiceUpdates(orderId, 'subtract');
      updates.push({
        sql: 'UPDATE orders SET status = ?, queueStatus = ? WHERE id = ?',
        params: [ORDER_STATUS.COMPLETED, 'pending', orderId]
      });
      updates.push({
        sql: 'UPDATE order_items SET queueStatus = ? WHERE orderId = ?',
        params: ['pending', orderId]
      });
      updates.push({
        sql: 'UPDATE order_discounts SET queueStatus = ? WHERE orderItemId in (SELECT id FROM order_items WHERE orderId = ?)',
        params: ['pending', orderId]
      });
    } 

    await executeUtils.executeTransaction(userDO, updates);
  };

  const processRefundTransaction = async (
    orderId: number,
    request: CreateRefund,
    refundResult: any
  ): Promise<number> => {

    const refundData = RefundSchema.parse({
      ...request,
      status: refundResult.responseCode === '00' 
          ? PAYMENT_STATUS.COMPLETED 
          : PAYMENT_STATUS.FAILED,
      refundDetails: refundResult
    });
    
    let operations = [];
    operations.push({
      table: 'refunds',
      operation: 'insert',
      data: refundData
    });
    operations.push({
      table: 'payments',
      operation: 'update',
      id: request.paymentId, 
      data: { status: PAYMENT_STATUS.CANCELLED }
    });

    operations.push({
      table: 'orders',
      operation: 'update',
      id: orderId, 
      data: { status: ORDER_STATUS.CANCELLED }
    });
    
    const updates = await getServiceUpdates(orderId, 'subtract');
    operations.push({
      operation: 'sql',
      data: updates
    });

    const results = await executeUtils.executeDynamicAction(userDO, 'multi-table', {operations: operations});
    
    return results[0].id;
  };

  const formatDateVNPay = (date: Date): string => {
    // Ép buộc tính theo giờ Việt Nam (UTC+7)
    const offset = 7 * 60; // +7 giờ tính bằng phút
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000); // chuyển về UTC
    const vnTime = new Date(utc + (offset * 60000));

    const year = vnTime.getFullYear();
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getDate()).padStart(2, '0');
    const hour = String(vnTime.getHours()).padStart(2, '0');
    const minute = String(vnTime.getMinutes()).padStart(2, '0');
    const second = String(vnTime.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}${second}`;
  };

  const createPaymentUrl = async (request: CreatePayment, ipAddr: string, identifier: string): Promise<string> => {
    
    paymentUtils.validateAmount(request.amount);

    const orders = await executeUtils.executeDynamicAction(userDO, 'select', { field: 'id', operator: '=', value: request.orderId }, 'orders');

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const order= orders[0];
    
    const date = new Date();
    
    const createDate = formatDateVNPay(date);
    const expireDate = formatDateVNPay(new Date(date.getTime() + VNPAY_CONSTANTS.TRANSACTION_TIMEOUT * 60 * 1000));
    
    const tmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnpUrl = config.get('vnp_Url');
    const returnUrl = config.get('vnp_ReturnUrl');
    
    const vnp_Params: Record<string, any> = {
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_PAY,
      'vnp_TmnCode': tmnCode,
      'vnp_Locale': request.language,
      'vnp_CurrCode': VNPAY_CONSTANTS.CURRENCY,
      'vnp_TxnRef': order.orderCode,
      'vnp_OrderInfo': `${request.language==='vn' ? 'Thanh toán đơn hàng:' : 'Payment order:'} ${order.notes}`,
      'vnp_OrderType': VNPAY_CONSTANTS.ORDER_TYPE,
      'vnp_Amount': request.amount * 100,
      'vnp_ReturnUrl': returnUrl, 
      'vnp_IpAddr': ipAddr,
      'vnp_CreateDate': createDate,
      'vnp_ExpireDate': expireDate
    };

    if (request.bankCode) {
      vnp_Params['vnp_BankCode'] = request.bankCode;
    }

    let sortedParams = cryptoService.sortObject(vnp_Params);
    const querystring = require('qs');
    const signData = querystring.stringify(sortedParams, { encode: false });
    const signed = cryptoService.createSHA512Signature(signData, secretKey);
    
    sortedParams['vnp_SecureHash'] = signed;
    
    const paymentData = PaymentSchema.parse({
      orderId: request.orderId,
      paymentMethod: request.bankCode === 'INTCARD' ? 'credit_card' : 'bank_transfer',
      gateway: 'vnpay',
      status: PAYMENT_STATUS.PENDING,
      paymentDetails: sortedParams
    });
    
    await executeUtils.executeDynamicAction(userDO, 'insert', paymentData, 'payments');

    const paymentUrl = vnpUrl + '?' + querystring.stringify(sortedParams, { encode: false });
    console.log(`${paymentUrl}`);
    return paymentUrl;
  };

  const processReturn = async (paymentId: number, params: VNPayReturn): Promise<PaymentResult> => {
    const orderId = await validatePayment(paymentId, parseInt(params.vnp_Amount) / 100);
    return {
      success: (params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00'),
      code: params.vnp_ResponseCode,
      message: paymentUtils.getResponseMessage(params.vnp_ResponseCode),  
      orderId: orderId,
      amount: parseInt(params.vnp_Amount) / 100,
      transactionNo: params.vnp_TransactionNo,
      bankCode: params.vnp_BankCode
    };
  };

  const processIPN = async (paymentId: number, params: VNPayReturn): Promise<PaymentResult> => {
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [paymentId], "payments"
    );

    if (payments.length === 0) {
      return {
        success: false,
        code: '01',
        message: PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND,  
      };
    }

    const payment = payments[0];
    
    if (payment.status !== PAYMENT_STATUS.PENDING) {
      return {
        success: false,
        code: '02',
        message: PAYMENT_ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED,  
      };
    }

    const expectedAmount = payment.paymentDetails.vnp_Amount / 100;

    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM orders WHERE id = ?',
      [payment.orderId], "orders"
    );

    if (orders.length === 0) {
      return {
        success: false,
        code: '01',
        message: PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND,  
      };
    }

    const order = orders[0];
    if (order.finalAmount !== expectedAmount) {
      return {
        success: false,
        code: '04',
        message: PAYMENT_ERROR_MESSAGES.INVALID_AMOUNT,  
      };
    }
    
    await processPaymentTransaction(paymentId, order.id, params);

    return {
      success: true,
      code: '00',
      message: 'Success',  
    };
  };

  const queryTransaction = async (request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> => {
    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT b.* FROM payments a, orders b WHERE a.id = ? and a.orderId = b.id',
      [request.paymentId], "orders"
    );

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    const order = orders[0];
    const date = new Date();
    const vnp_TmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnp_Api = config.get('vnp_Api');

    
    const vnp_CreateDate = formatDateVNPay(date);
    const vnp_RequestId = vnp_CreateDate.substring(vnp_CreateDate.length - 6);

    const data = `${vnp_RequestId}|${VNPAY_CONSTANTS.VERSION}|${VNPAY_CONSTANTS.COMMAND_QUERY}|${vnp_TmnCode}|${order.orderCode}|${request.transDate}|${vnp_CreateDate}|${ipAddr}|Truy van GD ma: ${order.orderCode}`;
    
    const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);
    
    const dataObj = {
      'vnp_RequestId': vnp_RequestId,
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_QUERY,
      'vnp_TmnCode': vnp_TmnCode,
      'vnp_TxnRef': order.orderCode,
      'vnp_OrderInfo': `Truy van GD ma: ${order.orderCode}`,
      'vnp_TransactionDate': request.transDate,
      'vnp_CreateDate': vnp_CreateDate,
      'vnp_IpAddr': ipAddr,
      'vnp_SecureHash': vnp_SecureHash
    };

    const response = await fetch(vnp_Api, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dataObj)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.json() as any;
    if (cryptoService.validateSignature(body, secretKey, body.vnp_SecureHash)) {
      throw new Error(PAYMENT_ERROR_MESSAGES.CHECKSUM_FAILED);
    }
    return {
      responseCode: body.vnp_ResponseCode,
      message: body.vnp_Message,
      transaction: body
    };
  };

  const refundTransaction = async (identifier: string, request: CreateRefund, ipAddr: string): Promise<RefundResult> => {
    const date = new Date();
    const vnp_TmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnp_Api = config.get('vnp_Api');

    const vnp_CreateDate = formatDateVNPay(date);
    const vnp_RequestId = vnp_CreateDate.substring(vnp_CreateDate.length - 6);

    
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ? AND status = ?',
      [request.paymentId, PAYMENT_STATUS.COMPLETED], "payments"
    );

    if (payments.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    const payment = payments[0];
    const vnp_TransactionNo = payment.paymentDetails.vnp_TransactionNo || '';

    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM orders WHERE id = ? AND status = ?',
      [payment.orderId, ORDER_STATUS.COMPLETED], "orders"
    );

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const order = orders[0];

    const data = `${vnp_RequestId}|${VNPAY_CONSTANTS.VERSION}|${VNPAY_CONSTANTS.COMMAND_REFUND}|${vnp_TmnCode}|${request.transactionType}|${order.orderCode}|${order.finalAmount}|${order.finalAmount * 100}|${vnp_TransactionNo}|${vnp_CreateDate}|${identifier}|${vnp_CreateDate}|${ipAddr}|Hoan tien GD ma: ${order.orderCode} voi ly do: ${request.reason}`;
    
    const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);

    const dataObj = {
      'vnp_RequestId': vnp_RequestId,
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_REFUND,
      'vnp_TmnCode': vnp_TmnCode,
      'vnp_TransactionType': request.transactionType,
      'vnp_TxnRef': order.orderCode,
      'vnp_Amount': order.finalAmount * 100,
      'vnp_OrderInfo': `Hoan tien GD ma: ${order.orderCode} voi ly do: ${request.reason}`,
      'vnp_TransactionNo': vnp_TransactionNo,
      'vnp_TransactionDate': vnp_CreateDate,      
      'vnp_CreateBy': identifier,
      'vnp_CreateDate': vnp_CreateDate,
      'vnp_IpAddr': ipAddr,      
      'vnp_SecureHash': vnp_SecureHash
    };

    const response = await fetch(vnp_Api, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dataObj)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.json() as any;

    if (cryptoService.validateSignature(body, secretKey, body.vnp_SecureHash)) {
      throw new Error(PAYMENT_ERROR_MESSAGES.CHECKSUM_FAILED);
    }
    
    if (body.vnp_ResponseCode !== '00') {
      throw new Error(body.message);
    }

    const refundId = await processRefundTransaction(order.id, request, body);

    return {
      responseCode: body.vnp_ResponseCode,
      message: body.vnp_Message,
      refundId
    };
  };

  return {
    createPaymentUrl,
    processReturn,
    processIPN,
    queryTransaction,
    refundTransaction
  };
}

export function createCryptoService(): ICryptoService {
  return {
    createSHA512Signature(data: string, secretKey: string): string {
      return cryptoUtils.createSHA512Signature(data, secretKey);
    },

    validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean {
      return cryptoUtils.validateSignature(params, secretKey, secureHash);
    },

    sortObject(obj: Record<string, any>): Record<string, any> {
      return paymentUtils.sortObject(obj);
    }
  };
}

// Create crypto service instance
const cryptoService = createCryptoService();