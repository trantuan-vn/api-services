interface VNPayConfig {
  vnp_TmnCode: string;
  vnp_HashSecret: string;
  vnp_Url: string;
  vnp_Api: string;
  vnp_ReturnUrl: string;
}

class Config {
  private vnpayConfig: VNPayConfig;

  constructor() {
    this.vnpayConfig = {
      vnp_TmnCode: process.env.VNP_TMNCODE || "1F69MIVG",
      vnp_HashSecret: process.env.VNP_HASHSECRET || "E9MO6EJLUHNPLSJVE3OFFKK6J2V0VL5E",
      vnp_Url: process.env.VNP_URL || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      vnp_Api: process.env.VNP_API || "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
      vnp_ReturnUrl: process.env.VNP_RETURNURL || "https://api.unitoken.trade/dashboard/vnpay/vnpay_return"
    };
  }

  // Get individual configuration values
  get(key: keyof VNPayConfig): string {
    return this.vnpayConfig[key];
  }

  // Get all VNPay configuration
  getVNPayConfig(): VNPayConfig {
    return { ...this.vnpayConfig };
  }

  // Validate configuration
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.vnpayConfig.vnp_TmnCode) {
      errors.push('vnp_TmnCode is required');
    }

    if (!this.vnpayConfig.vnp_HashSecret) {
      errors.push('vnp_HashSecret is required');
    }

    if (!this.vnpayConfig.vnp_Url) {
      errors.push('vnp_Url is required');
    }

    if (!this.vnpayConfig.vnp_Api) {
      errors.push('vnp_Api is required');
    }

    if (!this.vnpayConfig.vnp_ReturnUrl) {
      errors.push('vnp_ReturnUrl is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Check if running in sandbox mode
  isSandbox(): boolean {
    return this.vnpayConfig.vnp_Url.includes('sandbox');
  }

  // Get configuration for specific environment
  getEnvironment(): 'sandbox' | 'production' {
    return this.isSandbox() ? 'sandbox' : 'production';
  }
}

// Create singleton instance
const config = new Config();

// Export the singleton instance
export { config, Config };
export type { VNPayConfig };