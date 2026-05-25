import { describe, expect, it } from 'vitest';
import { normalizeBrandMapping, resolveTrendyolBrandId } from '../../src/modules/trendyol/trendyol.service';

describe('resolveTrendyolBrandId', () => {
  const mapping = { 'Optimoon Doğal Taş Takı': 1725494 };

  it('uses mapped brand when product brand is empty', () => {
    expect(resolveTrendyolBrandId(null, mapping)).toEqual({ brandId: 1725494, usedFallback: true });
    expect(resolveTrendyolBrandId('  ', mapping)).toEqual({ brandId: 1725494, usedFallback: true });
  });

  it('matches product brand to mapping key case-insensitively', () => {
    expect(resolveTrendyolBrandId('optimoon doğal taş takı', mapping)).toEqual({
      brandId: 1725494,
      usedFallback: false,
    });
  });

  it('falls back to single mapping when product brand label differs', () => {
    expect(resolveTrendyolBrandId('Başka Marka', mapping)).toEqual({
      brandId: 1725494,
      usedFallback: true,
    });
  });

  it('returns null when no mapping exists', () => {
    expect(resolveTrendyolBrandId(null, {})).toEqual({ brandId: null, usedFallback: false });
  });
});

describe('normalizeBrandMapping', () => {
  it('coerces string ids to numbers', () => {
    expect(normalizeBrandMapping({ Foo: '1725494' })).toEqual({ Foo: 1725494 });
  });
});
