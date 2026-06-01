import Iyzipay from 'iyzipay';
import type { IyzicoCredentials } from '../../payments/payment-provider.types';
import { tenantPaymentSettingsService } from '../../payments/tenant-payment-settings.service';

export const IYZICO_SANDBOX_BASE_URL = 'https://sandbox-api.iyzipay.com';
export const IYZICO_PRODUCTION_BASE_URL = 'https://api.iyzipay.com';

export type IyzicoStoreConfig = {
  apiKey:    string;
  secretKey: string;
  baseUrl:   string;
  testMode:  boolean;
  source:    'tenant';
};

export function isIyzicoCredentialsComplete(creds: IyzicoCredentials | null | undefined): boolean {
  return Boolean(creds?.apiKey?.trim() && creds?.secretKey?.trim());
}

/** Test/canlı moda göre baseUrl; kayıtlı URL geçerliyse onu kullanır. */
export function resolveIyzicoBaseUrl(isTestMode: boolean, storedBaseUrl?: string | null): string {
  const stored = storedBaseUrl?.trim();
  if (stored) {
    const normalized = stored.replace(/\/$/, '');
    if (normalized === IYZICO_SANDBOX_BASE_URL || normalized === IYZICO_PRODUCTION_BASE_URL) {
      return normalized;
    }
  }
  return isTestMode ? IYZICO_SANDBOX_BASE_URL : IYZICO_PRODUCTION_BASE_URL;
}

export function buildStoreIyzicoClient(config: IyzicoStoreConfig): Iyzipay {
  return new Iyzipay({
    apiKey:    config.apiKey,
    secretKey: config.secretKey,
    uri:       config.baseUrl,
  });
}

/**
 * Mağaza vitrini iyzico — yalnızca tenant ödeme ayarları.
 * Platform IYZICO_* ortam değişkenleri kullanılmaz.
 */
export async function resolveIyzicoConfig(tenantId: string): Promise<IyzicoStoreConfig> {
  const row = await tenantPaymentSettingsService.getActiveRow(tenantId, 'IYZICO');
  if (!row) {
    throw new Error('iyzico ödeme yöntemi bu mağazada aktif değil.');
  }

  const creds = await tenantPaymentSettingsService.getDecryptedCredentials<IyzicoCredentials>(
    tenantId,
    'IYZICO',
  );

  if (!isIyzicoCredentialsComplete(creds)) {
    throw new Error(
      'iyzico API bilgileri eksik. Yönetici panelinden API Key ve Secret Key girin.',
    );
  }

  return {
    apiKey:    creds!.apiKey.trim(),
    secretKey: creds!.secretKey.trim(),
    baseUrl:   resolveIyzicoBaseUrl(row.isTestMode, creds!.baseUrl),
    testMode:  row.isTestMode,
    source:    'tenant',
  };
}

function storefrontFrontendBase(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/** PayTR vitrin success/fail URL yapısı ile aynı desen. */
export function buildIyzicoRedirectUrls(
  tenantSlug: string,
  orderNumber: string,
): { okUrl: string; failUrl: string } {
  const frontendUrl = storefrontFrontendBase();
  const okBase = (
    process.env.IYZICO_SUCCESS_URL?.trim() || `${frontendUrl}/store/odeme-basarili`
  ).replace(/\/$/, '');
  const failBase = (
    process.env.IYZICO_FAIL_URL?.trim() || `${frontendUrl}/store/odeme-basarisiz`
  ).replace(/\/$/, '');
  const q = `tenant=${encodeURIComponent(tenantSlug)}`;
  const path = encodeURIComponent(orderNumber);
  return {
    okUrl:   `${okBase}/${path}?${q}`,
    failUrl: `${failBase}/${path}?${q}`,
  };
}

export function buildIyzicoGenericFailRedirect(reason: string): string {
  const frontendUrl = storefrontFrontendBase();
  const failBase = (
    process.env.IYZICO_FAIL_URL?.trim() || `${frontendUrl}/store/odeme-basarisiz`
  ).replace(/\/$/, '');
  return `${failBase}?reason=${encodeURIComponent(reason)}`;
}
