import prisma from '../../config/database';

export type PriceAdjustType = 'percentage' | 'fixed';
export type BulkPriceScope = 'selected' | 'all' | 'category';

export interface PricingRuleContext {
  categoryId?: string | null;
  brand?: string | null;
}

export interface PricingRuleRow {
  id: string;
  tenantId: string;
  name: string | null;
  type: string;
  value: number;
  applyTo: string;
  categoryId: string | null;
  brand: string | null;
  isActive: boolean;
  priority: number;
}

function normBrand(b: string | null | undefined): string {
  return (b ?? '').trim().toLowerCase();
}

export function normalizePriceType(raw: string): PriceAdjustType | null {
  const t = String(raw ?? '').toUpperCase();
  if (t === 'PERCENT' || t === 'PERCENTAGE') return 'percentage';
  if (t === 'FIXED') return 'fixed';
  return null;
}

export function computeAdjustedPrice(
  basePrice: number,
  type: PriceAdjustType,
  value: number,
  includeTax = false,
): number {
  const percent = type === 'percentage' ? value : undefined;
  const fixed = type === 'fixed' ? value : undefined;
  return computeBulkNewPrice(basePrice, { percent, fixed, includeTax });
}

/** Toplu fiyat: önce yüzde, sonra sabit TL (boş/0 alanlar atlanır). */
export function computeBulkNewPrice(
  basePrice: number,
  opts: { percent?: number; fixed?: number; includeTax?: boolean },
): number {
  let newPrice = basePrice;
  const percent = opts.percent;
  const fixed = opts.fixed;
  if (percent != null && percent !== 0 && Number.isFinite(percent)) {
    newPrice = newPrice * (1 + percent / 100);
  }
  if (fixed != null && fixed !== 0 && Number.isFinite(fixed)) {
    newPrice += fixed;
  }
  if (opts.includeTax) newPrice = newPrice * 1.18;
  return Math.max(0, Math.round(newPrice * 100) / 100);
}

export function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

export function getProductBasePrice(p: {
  price?: unknown;
  pricing?: { salePrice?: unknown } | null;
}): number {
  if (p.pricing?.salePrice != null) return Number(p.pricing.salePrice);
  return Number(p.price ?? 0);
}

function ruleSpecificity(applyTo: string): number {
  if (applyTo === 'BRAND') return 3;
  if (applyTo === 'CATEGORY') return 2;
  return 1;
}

export function pickMatchingPricingRule(
  rules: PricingRuleRow[],
  ctx: PricingRuleContext,
): PricingRuleRow | null {
  const brandNorm = normBrand(ctx.brand);
  const matches = rules.filter(r => {
    if (!r.isActive) return false;
    if (r.applyTo === 'ALL') return true;
    if (r.applyTo === 'CATEGORY' && r.categoryId && ctx.categoryId === r.categoryId) return true;
    if (r.applyTo === 'BRAND' && r.brand && brandNorm && normBrand(r.brand) === brandNorm) return true;
    return false;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const spec = ruleSpecificity(b.applyTo) - ruleSpecificity(a.applyTo);
    if (spec !== 0) return spec;
    return b.priority - a.priority;
  });
  return matches[0];
}

export async function listActivePricingRules(tenantId: string): Promise<PricingRuleRow[]> {
  const rows = await prisma.pricingRule.findMany({
    where:   { tenantId, isActive: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(r => ({
    ...r,
    value: Number(r.value),
  }));
}

export async function applyPricingRulesToPrice(
  tenantId: string,
  basePrice: number,
  ctx: PricingRuleContext,
): Promise<number> {
  const rules = await listActivePricingRules(tenantId);
  const rule = pickMatchingPricingRule(rules, ctx);
  if (!rule) return basePrice;
  const type = normalizePriceType(rule.type);
  if (!type) return basePrice;
  return computeAdjustedPrice(basePrice, type, rule.value);
}

export async function resolveBulkProductIds(
  tenantId: string,
  scope: BulkPriceScope,
  productIds?: string[],
  categoryId?: string,
): Promise<string[]> {
  if (scope === 'selected') {
    return [...new Set((productIds ?? []).filter(Boolean))];
  }
  if (scope === 'category') {
    if (!categoryId) throw new Error('categoryId zorunludur.');
    const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
    if (!cat) throw new Error('Kategori bulunamadı.');
    const rows = await prisma.product.findMany({
      where:  { tenantId, categoryId },
      select: { id: true },
    });
    return rows.map(r => r.id);
  }
  const rows = await prisma.product.findMany({
    where:  { tenantId },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

export async function applyImportPricingRules(
  tenantId: string,
  data: {
    price?: number;
    discountPrice?: number;
    category?: string;
    brand?: string;
  },
): Promise<void> {
  if (data.price == null && data.discountPrice == null) return;

  let categoryId: string | null = null;
  if (data.category?.trim()) {
    const cat = await prisma.category.findFirst({
      where: {
        tenantId,
        name: { equals: data.category.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    categoryId = cat?.id ?? null;
  }

  const ctx: PricingRuleContext = {
    categoryId,
    brand: data.brand ?? null,
  };

  if (data.price != null) {
    data.price = await applyPricingRulesToPrice(tenantId, data.price, ctx);
  }
  if (data.discountPrice != null) {
    data.discountPrice = await applyPricingRulesToPrice(tenantId, data.discountPrice, ctx);
  }
}
