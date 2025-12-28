import crypto from 'crypto';

// Private helper functions
export const paymentUtils = {
  sortObject(obj: Record<string, any>): Record<string, any> {
    const sorted: Record<string, any> = {};
    const keys = Object.keys(obj).filter(key => obj.hasOwnProperty(key));
    
    keys.sort().forEach(key => {
      sorted[encodeURIComponent(key)] = encodeURIComponent(obj[key]).replace(/%20/g, "+");
    });
    
    return sorted;
  },
  getTransactionStatusMessage(transactionStatus: string): string {
    const messages: Record<string, string> = {
      '00': 'Giao dịch thành công',
      '01': 'Giao dịch chưa hoàn tất',
      '02': 'Giao dịch bị lỗi',
      '04': 'Giao dịch đảo (Khách hàng đã bị trừ tiền tại Ngân hàng nhưng GD chưa thành công ở VNPAY)',
      '05': 'VNPAY đang xử lý giao dịch này (GD hoàn tiền)',
      '06': 'VNPAY đã gửi yêu cầu hoàn tiền sang Ngân hàng (GD hoàn tiền)',
      '07': 'Giao dịch bị nghi ngờ gian lận',
      '09': 'GD Hoàn trả bị từ chối'
    };
    
    return messages[transactionStatus] || 'Mã lỗi không xác định';
  },
  getResponseMessage(responseCode: string): string {
    const messages: Record<string, string> = {
      '00': 'Giao dịch thành công',
      '07': 'Trừ tiền thành công. Giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường).',
      '09': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng chưa đăng ký dịch vụ InternetBanking',
      '10': 'Giao dịch không thành công do: Khách hàng xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
      '11': 'Giao dịch không thành công do: Đã hết hạn chờ thanh toán. Xin quý khách vui lòng thực hiện lại giao dịch.',
      '12': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng bị khóa.',
      '13': 'Giao dịch không thành công do Quý khách nhập sai mật khẩu xác thực giao dịch (OTP). Xin quý khách vui lòng thực hiện lại giao dịch.',
      '24': 'Giao dịch không thành công do: Khách hàng hủy giao dịch',
      '51': 'Giao dịch không thành công do: Tài khoản của quý khách không đủ số dư để thực hiện giao dịch.',
      '65': 'Giao dịch không thành công do: Tài khoản của Quý khách đã vượt quá hạn mức giao dịch trong ngày.',
      '75': 'Ngân hàng thanh toán đang bảo trì.',
      '79': 'Giao dịch không thành công do: KH nhập sai mật khẩu thanh toán quá số lần quy định. Xin quý khách vui lòng thực hiện lại giao dịch',
      '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
    };
    
    return messages[responseCode] || 'Unknown error';
  },

  getQueryDRMessage(responseCode: string): string {
    const messages: Record<string, string> = {
      '00': 'Yêu cầu thành công',
      '02': 'Mã định danh kết nối không hợp lệ (kiểm tra lại TmnCode)',
      '03': 'Dữ liệu gửi sang không đúng định dạng',
      '91': 'Không tìm thấy giao dịch yêu cầu',
      '94': 'Yêu cầu trùng lặp, duplicate request trong thời gian giới hạn của API',
      '97': 'Checksum không hợp lệ',
      '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
    };
    return messages[responseCode] || 'Unknown error';
  },

  getRefundMessage(responseCode: string): string {
    const messages: Record<string, string> = {
      '00': 'Yêu cầu thành công',
      '02': 'Mã định danh kết nối không hợp lệ (kiểm tra lại TmnCode)',
      '03': 'Dữ liệu gửi sang không đúng định dạng',
      '91': 'Không tìm thấy giao dịch yêu cầu hoàn trả',
      '94': 'Giao dịch đã được gửi yêu cầu hoàn tiền trước đó. Yêu cầu này VNPAY đang xử lý',
      '95': 'Giao dịch này không thành công bên VNPAY. VNPAY từ chối xử lý yêu cầu',
      '97': 'Checksum không hợp lệ',
      '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
    };
    return messages[responseCode] || 'Unknown error';
  },

  createPaymentReference(identifier: string, paymentId: number, orderId: number): string {
    return `${identifier}.${paymentId}.${orderId}`;
  },

  parsePaymentReference(txnRef: string): { identifier: string; paymentId: number; orderId: number } {
    const splitData = txnRef.split('.');
    if (splitData.length !== 3) {
      throw new Error('Invalid payment reference: missing required fields');
    }
    
    return {
      identifier: splitData[0],
      paymentId: parseInt(splitData[1]),
      orderId: parseInt(splitData[2])
    };          
  },

  validateAmount(amount: number): void {
    if (amount < 1000) {
      throw new Error('Amount must be at least 1,000 VND');
    }
  }
};

export const cryptoUtils = {
  createSHA512Signature(data: string, secretKey: string): string {
    const hmac = crypto.createHmac("sha512", secretKey);
    return hmac.update(Buffer.from(data, 'utf-8')).digest("hex");
  },

  validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean {
    const sortedParams = paymentUtils.sortObject(params);
    const querystring = require('qs');
    const signData = querystring.stringify(sortedParams, { encode: false });
    const calculatedHash = this.createSHA512Signature(signData, secretKey);
    return secureHash === calculatedHash;
  }
};