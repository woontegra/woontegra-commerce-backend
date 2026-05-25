import { describe, it, expect } from 'vitest';
import { applyTrendyolPriceStrategy } from '../../src/modules/trendyol/trendyol-price.util';

describe('applyTrendyolPriceStrategy', () => {
  it('mode none — base fiyat aynen kalır', () => {
    const r = applyTrendyolPriceStrategy(100, 120, { mode: 'none', value: 0, vatRate: 20, vatIncluded: false, roundTo: 2 }, null);
    expect(r.finalPrice).toBe(100);
    expect(r.appliedStrategy).toBe(false);
  });

  it('mode percent +40 — 100 → 140', () => {
    const r = applyTrendyolPriceStrategy(
      100,
      100,
      { mode: 'percent', value: 40, vatRate: 20, vatIncluded: false, roundTo: 2 },
      null,
    );
    expect(r.finalPrice).toBe(140);
    expect(r.appliedStrategy).toBe(true);
  });

  it('mode fixed +50 — 100 → 150', () => {
    const r = applyTrendyolPriceStrategy(
      100,
      100,
      { mode: 'fixed', value: 50, vatRate: 20, vatIncluded: false, roundTo: 2 },
      null,
    );
    expect(r.finalPrice).toBe(150);
  });

  it('customPrice override — stratejiyi ezer', () => {
    const r = applyTrendyolPriceStrategy(
      100,
      100,
      { mode: 'percent', value: 100, vatRate: 20, vatIncluded: false, roundTo: 2 },
      { customPrice: 199.99 },
    );
    expect(r.finalPrice).toBe(199.99);
    expect(r.appliedOverride).toBe(true);
    expect(r.appliedStrategy).toBe(false);
  });

  it('listPrice finalPrice altına düşmez', () => {
    const r = applyTrendyolPriceStrategy(50, 200, { mode: 'none', value: 0, vatRate: 20, vatIncluded: false, roundTo: 2 }, null);
    expect(r.listPrice).toBeGreaterThanOrEqual(r.finalPrice);
  });
});
