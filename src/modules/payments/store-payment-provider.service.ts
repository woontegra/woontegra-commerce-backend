import { PaymentProviderType } from '@prisma/client';
import { isIyzicoCredentialsComplete } from '../store-public/iyzico/store-iyzico.config';
import {
  DEFAULT_DISPLAY_NAMES,
  STOREFRONT_MANUAL_PROVIDERS,
  STOREFRONT_ONLINE_PROVIDERS,
  type BankTransferPublicConfig,
  type CashOnDeliveryPublicConfig,
  type IyzicoCredentials,
  type PaytrCredentials,
  type PublicPaymentMethod,
} from './payment-provider.types';
import { tenantPaymentSettingsService } from './tenant-payment-settings.service';

function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

function isPaytrConfigured(creds: PaytrCredentials | null): boolean {
  return Boolean(creds?.merchantId && creds?.merchantKey && creds?.merchantSalt);
}

export class StorePaymentProviderService {
  /** Vitrin checkout — yalnızca aktif ve desteklenen yöntemler; gizli alan yok. */
  async listActiveMethodsForStorefront(tenantId: string): Promise<PublicPaymentMethod[]> {
    const methods: PublicPaymentMethod[] = [];

    for (const provider of STOREFRONT_ONLINE_PROVIDERS) {
      if (provider === 'PAYTR') {
        const row = await tenantPaymentSettingsService.getActiveRow(tenantId, 'PAYTR');
        if (!row) continue;
        const creds = await tenantPaymentSettingsService.getDecryptedCredentials<PaytrCredentials>(
          tenantId,
          'PAYTR',
        );
        if (!isPaytrConfigured(creds)) continue;
        methods.push({
          provider:    'PAYTR',
          displayName: row.displayName ?? DEFAULT_DISPLAY_NAMES.PAYTR,
          isActive:    true,
          isTestMode:  row.isTestMode,
        });
      }

      if (provider === 'IYZICO') {
        const row = await tenantPaymentSettingsService.getActiveRow(tenantId, 'IYZICO');
        if (!row) continue;
        const creds = await tenantPaymentSettingsService.getDecryptedCredentials<IyzicoCredentials>(
          tenantId,
          'IYZICO',
        );
        if (!isIyzicoCredentialsComplete(creds)) continue;
        methods.push({
          provider:    'IYZICO',
          displayName: row.displayName ?? DEFAULT_DISPLAY_NAMES.IYZICO,
          description: 'Kredi/banka kartı ile güvenli ödeme',
          isActive:    true,
          isTestMode:  row.isTestMode,
        });
      }
    }

    for (const provider of STOREFRONT_MANUAL_PROVIDERS) {
      const row = await tenantPaymentSettingsService.getActiveRow(tenantId, provider);
      if (!row) continue;

      if (provider === 'BANK_TRANSFER') {
        const pub = (row.publicConfigJson ?? {}) as BankTransferPublicConfig;
        const bankName = pub.bankName?.trim();
        const iban = pub.iban?.trim();
        if (!bankName || !iban) continue;
        methods.push({
          provider:    'BANK_TRANSFER',
          displayName: row.displayName ?? DEFAULT_DISPLAY_NAMES.BANK_TRANSFER,
          isActive:    true,
          bankAccounts: [{
            bankName,
            accountHolder: pub.accountHolder?.trim() || '—',
            ibanMasked:    maskIban(iban),
            description:   pub.description,
          }],
        });
      }

      if (provider === 'CASH_ON_DELIVERY') {
        const pub = (row.publicConfigJson ?? {}) as CashOnDeliveryPublicConfig;
        methods.push({
          provider:     'CASH_ON_DELIVERY',
          displayName:  row.displayName ?? DEFAULT_DISPLAY_NAMES.CASH_ON_DELIVERY,
          isActive:     true,
          extraFee:     pub.extraFee,
          description:  pub.description,
        });
      }
    }

    return methods;
  }

  isStorefrontProvider(provider: string): provider is PaymentProviderType {
    return ['PAYTR', 'IYZICO', 'BANK_TRANSFER', 'CASH_ON_DELIVERY'].includes(provider);
  }
}

export const storePaymentProviderService = new StorePaymentProviderService();
