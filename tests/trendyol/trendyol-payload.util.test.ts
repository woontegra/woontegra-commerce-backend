import { describe, it, expect } from 'vitest';
import { buildTrendyolProductPricePayload } from '../../src/modules/trendyol/trendyol-payload.util';

describe('buildTrendyolProductPricePayload', () => {
  it('percent stratejisi payload fiyatına yansır', () => {
    const payload = buildTrendyolProductPricePayload({
      baseSalePrice: 100,
      baseListPrice: 120,
      strategy:      { mode: 'percent', value: 40, vatRate: 20, vatIncluded: false, roundTo: 2 },
    });

    expect(payload.salePrice).toBe(140);
    expect(payload.listPrice).toBeGreaterThanOrEqual(140);
  });
});
