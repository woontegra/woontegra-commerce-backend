import type { PaytrCredentials } from '../../payments/payment-provider.types';
import { tenantPaymentSettingsService } from '../../payments/tenant-payment-settings.service';

export type PaytrConfig = {
  merchantId:   string;
  merchantKey:  string;
  merchantSalt: string;
  testMode:     boolean;
  callbackUrl:  string;
  successUrl:   string;
  failUrl:      string;
  /** Tenant DB ayarı mı, env fallback mi */
  source: 'tenant' | 'env';
};

function envPaytrConfig(): PaytrConfig | null {
  const merchantId   = process.env.PAYTR_MERCHANT_ID?.trim();
  const merchantKey  = process.env.PAYTR_MERCHANT_KEY?.trim();
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT?.trim();
  if (!merchantId || !merchantKey || !merchantSalt) return null;

  const backendUrl  = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

  return {
    merchantId,
    merchantKey,
    merchantSalt,
    testMode:    process.env.PAYTR_TEST_MODE === 'true' || process.env.PAYTR_TEST_MODE === '1',
    callbackUrl: process.env.PAYTR_CALLBACK_URL?.trim() || `${backendUrl}/api/store/payments/paytr/callback`,
    successUrl:  process.env.PAYTR_SUCCESS_URL?.trim() || `${frontendUrl}/store/odeme-basarili`,
    failUrl:     process.env.PAYTR_FAIL_URL?.trim() || `${frontendUrl}/store/odeme-basarisiz`,
    source:      'env',
  };
}

/**
 * PayTR — önce tenant ödeme ayarı; yoksa yalnızca local/dev için env fallback.
 * Production'da env fallback kullanılıyorsa log uyarısı üretilir.
 */
export async function resolvePaytrConfig(
  tenantId: string,
  _tenantSlug: string,
): Promise<PaytrConfig | null> {
  const row = await tenantPaymentSettingsService.getActiveRow(tenantId, 'PAYTR');
  if (row) {
    const creds = await tenantPaymentSettingsService.getDecryptedCredentials<PaytrCredentials>(
      tenantId,
      'PAYTR',
    );
    if (creds?.merchantId && creds?.merchantKey && creds?.merchantSalt) {
      const backendUrl  = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
      return {
        merchantId:   creds.merchantId,
        merchantKey:  creds.merchantKey,
        merchantSalt: creds.merchantSalt,
        testMode:     row.isTestMode,
        callbackUrl:  process.env.PAYTR_CALLBACK_URL?.trim() || `${backendUrl}/api/store/payments/paytr/callback`,
        successUrl:   process.env.PAYTR_SUCCESS_URL?.trim() || `${frontendUrl}/store/odeme-basarili`,
        failUrl:      process.env.PAYTR_FAIL_URL?.trim() || `${frontendUrl}/store/odeme-basarisiz`,
        source:       'tenant',
      };
    }
  }

  const env = envPaytrConfig();
  if (env && process.env.NODE_ENV === 'production') {
    console.warn(
      '[PayTR] Tenant PAYTR ayarı yok; production ortamında env fallback kullanılıyor. ' +
        'Tenant ödeme ayarlarını yapılandırın.',
    );
  }
  return env;
}

export function buildPaytrRedirectUrls(
  config: PaytrConfig,
  tenantSlug: string,
  orderNumber: string,
): { okUrl: string; failUrl: string } {
  const q = `tenant=${encodeURIComponent(tenantSlug)}`;
  const okBase  = config.successUrl.replace(/\/$/, '');
  const failBase = config.failUrl.replace(/\/$/, '');
  const path = encodeURIComponent(orderNumber);
  return {
    okUrl:   `${okBase}/${path}?${q}`,
    failUrl: `${failBase}/${path}?${q}`,
  };
}
