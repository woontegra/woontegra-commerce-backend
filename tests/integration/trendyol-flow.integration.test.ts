import { describe, it, expect, beforeEach } from 'vitest';
import { Plan } from '@prisma/client';
import { buildTrendyolProductPricePayload } from '../../src/modules/trendyol/trendyol-payload.util';
import { shouldRunIntegrationTests, integrationPrisma, resetIntegrationDb } from './helpers/db';
import { seedProduct, seedTenantWithUser } from './helpers/seed';

const run = shouldRunIntegrationTests() ? describe : describe.skip;

run('Integration: Trendyol flow', () => {
  beforeEach(async () => {
    await resetIntegrationDb();
  });

  it('ürün + fiyat stratejisi → Trendyol payload fiyatı doğru', async () => {
    const { tenantId } = await seedTenantWithUser({ plan: Plan.PRO });

    const product = await seedProduct(tenantId, 1, { salePrice: 100, sku: 'TY-100' });

    await integrationPrisma.trendyolIntegration.create({
      data: {
        tenantId,
        supplierId: `supplier-${Date.now()}`,
        apiKey:     'enc-test',
        apiSecret:  'enc-test',
        isActive:   true,
        priceStrategy: {
          mode:        'percent',
          value:       40,
          vatRate:     20,
          vatIncluded: false,
          roundTo:     2,
        },
      },
    });

    const integration = await integrationPrisma.trendyolIntegration.findFirst({
      where: { tenantId },
    });
    const strategy = (integration?.priceStrategy as Record<string, unknown>) ?? {};

    const baseSale = Number(product.pricing!.salePrice);
    const baseList = Number(product.pricing!.salePrice) * 1.2;

    const payload = buildTrendyolProductPricePayload({
      baseSalePrice: baseSale,
      baseListPrice: baseList,
      strategy:      strategy as any,
      override:      null,
    });

    expect(payload.salePrice).toBe(140);
    expect(payload.listPrice).toBeGreaterThanOrEqual(140);
    expect(payload.vatRate).toBe(20);
    expect(payload.calc.appliedStrategy).toBe(true);
  });
});
