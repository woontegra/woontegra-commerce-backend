import {
  applyTrendyolPriceStrategy,
  type CalculatedPrice,
  type PriceStrategy,
  type ProductPriceOverride,
} from './trendyol-price.util';

export interface TrendyolProductPricePayload {
  salePrice: number;
  listPrice: number;
  vatRate:   number;
  calc:      CalculatedPrice;
}

/**
 * Trendyol ürün gönderim payload'ındaki fiyat alanları (salePrice / listPrice / vatRate).
 */
export function buildTrendyolProductPricePayload(params: {
  baseSalePrice: number;
  baseListPrice: number;
  strategy:      Partial<PriceStrategy>;
  override?:     ProductPriceOverride | null;
}): TrendyolProductPricePayload {
  const calc = applyTrendyolPriceStrategy(
    params.baseSalePrice,
    params.baseListPrice,
    params.strategy,
    params.override ?? null,
  );

  return {
    salePrice: calc.finalPrice,
    listPrice: calc.listPrice,
    vatRate:   calc.vatRate,
    calc,
  };
}
