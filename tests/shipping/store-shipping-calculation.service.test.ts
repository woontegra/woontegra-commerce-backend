import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => ({
  default: {
    product: { findFirst: vi.fn() },
    productVariant: { findFirst: vi.fn() },
  },
}));

vi.mock('../../src/modules/shipping/tenant-shipping-settings.service', () => ({
  tenantShippingSettingsService: {
    getForStorefront: vi.fn(),
  },
}));

vi.mock('../../src/modules/payments/tenant-payment-settings.service', () => ({
  tenantPaymentSettingsService: {
    getActiveRow: vi.fn(),
  },
}));

import prisma from '../../src/config/database';
import { tenantShippingSettingsService } from '../../src/modules/shipping/tenant-shipping-settings.service';
import { tenantPaymentSettingsService } from '../../src/modules/payments/tenant-payment-settings.service';
import { storeShippingCalculationService } from '../../src/modules/shipping/store-shipping-calculation.service';

describe('StoreShippingCalculationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tenantShippingSettingsService.getForStorefront).mockResolvedValue({
      isActive:              true,
      displayName:           'Standart Kargo',
      standardShippingCost:  79.9,
      freeShippingThreshold: 750,
      description:           null,
    });
    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      id:       'p1',
      name:     'Test',
      price:    100,
      pricing:  { salePrice: 100, discountPrice: null },
    } as never);
  });

  it('applies standard shipping below free threshold', async () => {
    const result = await storeShippingCalculationService.calculate(
      'tenant-1',
      [{ productId: 'p1', quantity: 2 }],
    );
    expect(result.shipping.shippingTotal).toBe(79.9);
    expect(result.shipping.freeShippingApplied).toBe(false);
    expect(result.subtotal).toBe(200);
    expect(result.grandTotal).toBe(279.9);
  });

  it('applies free shipping at threshold', async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      id:       'p1',
      name:     'Test',
      price:    400,
      pricing:  { salePrice: 400, discountPrice: null },
    } as never);

    const result = await storeShippingCalculationService.calculate(
      'tenant-1',
      [{ productId: 'p1', quantity: 2 }],
    );
    expect(result.shipping.shippingTotal).toBe(0);
    expect(result.shipping.freeShippingApplied).toBe(true);
    expect(result.grandTotal).toBe(800);
  });

  it('adds cash on delivery fee from payment settings', async () => {
    vi.mocked(tenantPaymentSettingsService.getActiveRow).mockResolvedValue({
      publicConfigJson: { extraFee: 25 },
    } as never);

    const result = await storeShippingCalculationService.calculate(
      'tenant-1',
      [{ productId: 'p1', quantity: 1 }],
      'CASH_ON_DELIVERY',
    );
    expect(result.fees.cashOnDeliveryFee).toBe(25);
    expect(result.grandTotal).toBe(100 + 79.9 + 25);
  });

  it('no COD fee for bank transfer', async () => {
    vi.mocked(tenantPaymentSettingsService.getActiveRow).mockResolvedValue(null);

    const result = await storeShippingCalculationService.calculate(
      'tenant-1',
      [{ productId: 'p1', quantity: 1 }],
      'BANK_TRANSFER',
    );
    expect(result.fees.cashOnDeliveryFee).toBe(0);
  });
});
