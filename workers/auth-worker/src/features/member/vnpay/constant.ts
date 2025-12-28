// Payment Error Messages
export const PAYMENT_ERROR_MESSAGES = {
  INVALID_REQUEST: 'Invalid request parameters',
  CHECKSUM_FAILED: 'Checksum validation failed',
  ORDER_NOT_FOUND: 'Order not found',
  PAYMENT_NOT_FOUND: 'Payment not found',
  INVALID_AMOUNT: 'Invalid amount',
  PAYMENT_ALREADY_PROCESSED: 'Payment already processed',
  SERVICE_NOT_FOUND: 'Service not found or inactive',
  INSUFFICIENT_BALANCE: 'Insufficient balance',
  TRANSACTION_EXPIRED: 'Transaction expired',
  BANK_MAINTENANCE: 'Bank is under maintenance',
  REFUND_FAILED: 'Refund failed',
  QUERY_FAILED: 'Transaction query failed'
} as const;

// VNPay Configuration Constants
export const VNPAY_CONSTANTS = {
  VERSION: '2.1.0',
  CURRENCY: 'VND',
  ORDER_TYPE: 'billpayment',
  COMMAND_PAY: 'pay',
  COMMAND_QUERY: 'querydr',
  COMMAND_REFUND: 'refund',
  TRANSACTION_TIMEOUT: 15, // minutes
  LOCALE_VN: 'vn',
  LOCALE_EN: 'en'
} as const;

// Payment Status Constants
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING'
} as const;