import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => ({
  default: {
    tenantPaymentSetting: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/payments/tenant-payment-settings.service', () => ({
  tenantPaymentSettingsService: {
    getActiveRow: vi.fn(),
    getDecryptedCredentials: vi.fn(),
  },
}));

import { tenantPaymentSettingsService } from '../../src/modules/payments/tenant-payment-settings.service';
import { StorePaymentProviderService } from '../../src/modules/payments/store-payment-provider.service';

describe('StorePaymentProviderService', () => {
  const svc = new StorePaymentProviderService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists PAYTR without secrets', async () => {
    vi.mocked(tenantPaymentSettingsService.getActiveRow).mockImplementation(
      async (_t, provider) =>
        provider === 'PAYTR'
          ? ({ displayName: 'Kart', isTestMode: true } as never)
          : null,
    );
    vi.mocked(tenantPaymentSettingsService.getDecryptedCredentials).mockResolvedValue({
      merchantId: '1',
      merchantKey: 'secret',
      merchantSalt: 'salt',
    });

    const methods = await svc.listActiveMethodsForStorefront('tenant-1');
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      provider: 'PAYTR',
      displayName: 'Kart',
      isTestMode: true,
    });
    expect(JSON.stringify(methods)).not.toContain('secret');
  });

  it('masks IBAN in bank transfer', async () => {
    vi.mocked(tenantPaymentSettingsService.getActiveRow).mockImplementation(
      async (_tenantId, provider) => {
        if (provider === 'BANK_TRANSFER') {
          return {
            displayName: 'Havale',
            publicConfigJson: {
              bankName: 'Demo',
              accountHolder: 'ACME',
              iban: 'TR330006100519786457841326',
            },
          } as never;
        }
        return null;
      },
    );

    const methods = await svc.listActiveMethodsForStorefront('tenant-1');
    const bank = methods.find(m => m.provider === 'BANK_TRANSFER');
    expect(bank).toBeDefined();
    if (bank?.provider === 'BANK_TRANSFER') {
      expect(bank.bankAccounts[0].ibanMasked).toContain('****');
      expect(bank.bankAccounts[0].ibanMasked).not.toContain('457841326');
    }
  });
});
