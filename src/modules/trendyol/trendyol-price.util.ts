/**
 * Saf Trendyol fiyat hesaplama — test edilebilir, yan etkisiz.
 */

export interface PriceStrategy {
  mode:        'none' | 'percent' | 'fixed';
  value:       number;
  vatRate:     number;
  vatIncluded: boolean;
  roundTo:     number;
}

export interface ProductPriceOverride {
  customPrice?: number;
  mode?:        'none' | 'percent' | 'fixed';
  value?:       number;
  vatRate?:     number;
}

export interface CalculatedPrice {
  basePrice:         number;
  finalPrice:        number;
  listPrice:         number;
  vatRate:           number;
  appliedOverride:   boolean;
  appliedStrategy:   boolean;
}

export function applyTrendyolPriceStrategy(
  basePrice: number,
  listPrice: number,
  strategy: Partial<PriceStrategy>,
  override: ProductPriceOverride | null,
): CalculatedPrice {
  const roundTo = strategy.roundTo ?? 2;
  const round   = (n: number) => Math.round(n * 10 ** roundTo) / 10 ** roundTo;

  if (override?.customPrice && override.customPrice > 0) {
    const vatRate = override.vatRate ?? strategy.vatRate ?? 20;
    return {
      basePrice,
      finalPrice:      round(override.customPrice),
      listPrice:       Math.max(round(override.customPrice), round(listPrice)),
      vatRate,
      appliedOverride: true,
      appliedStrategy: false,
    };
  }

  const mode  = override?.mode ?? strategy.mode ?? 'none';
  const value = override?.value ?? strategy.value ?? 0;
  const vatRate = override?.vatRate ?? strategy.vatRate ?? 20;

  let finalPrice = basePrice;
  let appliedStrategy = false;

  if (mode === 'percent' && value !== 0) {
    finalPrice = basePrice * (1 + value / 100);
    appliedStrategy = true;
  } else if (mode === 'fixed' && value !== 0) {
    finalPrice = basePrice + value;
    appliedStrategy = true;
  }

  const appliedOverride = Boolean(override?.mode || override?.value);

  return {
    basePrice,
    finalPrice:      round(Math.max(finalPrice, 0)),
    listPrice:       Math.max(round(listPrice), round(Math.max(finalPrice, 0))),
    vatRate,
    appliedOverride,
    appliedStrategy,
  };
}
