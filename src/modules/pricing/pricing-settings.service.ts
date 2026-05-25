import prisma from '../../config/database';

export interface PriceStrategyShape {
  mode:        'none' | 'percent' | 'fixed';
  value:       number;
  vatRate:     number;
  vatIncluded: boolean;
  roundTo:     number;
}

export interface PricingSettingsDto {
  type:        'none' | 'percent' | 'fixed';
  value:       number;
  vatRate:     number;
  rounding:    number;
  vatIncluded: boolean;
}

const DEFAULTS: PricingSettingsDto = {
  type:        'none',
  value:       0,
  vatRate:     20,
  rounding:    2,
  vatIncluded: false,
};

function normalizeType(raw: unknown): PricingSettingsDto['type'] {
  const t = String(raw ?? 'none').toLowerCase();
  if (t === 'percent' || t === 'percentage') return 'percent';
  if (t === 'fixed') return 'fixed';
  return 'none';
}

function rowToDto(row: {
  type: string;
  value: unknown;
  vatRate: unknown;
  rounding: number;
  vatIncluded: boolean;
}): PricingSettingsDto {
  return {
    type:        normalizeType(row.type),
    value:       Number(row.value),
    vatRate:     Number(row.vatRate),
    rounding:    row.rounding ?? 2,
    vatIncluded: row.vatIncluded ?? false,
  };
}

/** TrendyolService.applyPriceStrategy ile uyumlu */
export function toPriceStrategy(dto: PricingSettingsDto): Partial<PriceStrategyShape> {
  return {
    mode:        dto.type,
    value:       dto.value,
    vatRate:     dto.vatRate,
    vatIncluded: dto.vatIncluded,
    roundTo:     dto.rounding,
  };
}

function dtoFromLegacyJson(saved: Record<string, unknown>): PricingSettingsDto {
  return {
    type:        normalizeType(saved.mode ?? saved.type),
    value:       Number(saved.value ?? 0),
    vatRate:     Number(saved.vatRate ?? 20),
    rounding:    Number(saved.roundTo ?? saved.rounding ?? 2),
    vatIncluded: Boolean(saved.vatIncluded ?? false),
  };
}

export async function getPricingSettings(tenantId: string): Promise<PricingSettingsDto> {
  const row = await prisma.pricingSettings.findUnique({ where: { tenantId } });
  if (row) return rowToDto(row);

  const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
  const legacy = (integration?.priceStrategy as Record<string, unknown> | null) ?? {};
  if (legacy.mode || legacy.type || legacy.value) {
    const dto = dtoFromLegacyJson(legacy);
    const row = await prisma.pricingSettings.upsert({
      where:  { tenantId },
      create: {
        tenantId,
        type:        dto.type,
        value:       dto.value,
        vatRate:     dto.vatRate,
        rounding:    dto.rounding,
        vatIncluded: dto.vatIncluded,
      },
      update: {
        type:        dto.type,
        value:       dto.value,
        vatRate:     dto.vatRate,
        rounding:    dto.rounding,
        vatIncluded: dto.vatIncluded,
      },
    });
    return rowToDto(row);
  }

  return { ...DEFAULTS };
}

export async function savePricingSettings(
  tenantId: string,
  input: Partial<PricingSettingsDto> & { mode?: string },
): Promise<PricingSettingsDto> {
  const current = await getPricingSettings(tenantId);
  const dto: PricingSettingsDto = {
    type:        input.type != null ? normalizeType(input.type) : input.mode != null ? normalizeType(input.mode) : current.type,
    value:       input.value != null ? Number(input.value) : current.value,
    vatRate:     input.vatRate != null ? Number(input.vatRate) : current.vatRate,
    rounding:    input.rounding != null ? Math.max(0, Math.min(4, Math.floor(input.rounding))) : current.rounding,
    vatIncluded: input.vatIncluded != null ? Boolean(input.vatIncluded) : current.vatIncluded,
  };

  const row = await prisma.pricingSettings.upsert({
    where:  { tenantId },
    create: {
      tenantId,
      type:        dto.type,
      value:       dto.value,
      vatRate:     dto.vatRate,
      rounding:    dto.rounding,
      vatIncluded: dto.vatIncluded,
    },
    update: {
      type:        dto.type,
      value:       dto.value,
      vatRate:     dto.vatRate,
      rounding:    dto.rounding,
      vatIncluded: dto.vatIncluded,
    },
  });

  const strategyJson = toPriceStrategy(dto);
  const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
  if (integration) {
    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { priceStrategy: strategyJson as object },
    });
  }

  return rowToDto(row);
}

export async function resolveGlobalPriceStrategy(tenantId: string): Promise<Partial<PriceStrategyShape>> {
  const dto = await getPricingSettings(tenantId);
  return toPriceStrategy(dto);
}

export function logTrendyolPriceCalc(params: {
  productId:   string;
  productName: string;
  basePrice:   number;
  strategy:    Partial<PriceStrategyShape>;
  finalPrice:  number;
  listPrice:   number;
}): void {
  console.log('[Trendyol Price]', {
    productId:   params.productId,
    productName: params.productName,
    basePrice:   params.basePrice,
    strategy:    {
      type:  params.strategy.mode ?? 'none',
      value: params.strategy.value ?? 0,
      vatRate: params.strategy.vatRate,
      rounding: params.strategy.roundTo,
    },
    finalPrice: params.finalPrice,
    listPrice:  params.listPrice,
  });
}
