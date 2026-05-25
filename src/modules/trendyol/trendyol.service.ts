/**
 * Trendyol Integration Service — Production Level
 * WooCommerce-like product → Trendyol sending system
 */

import prisma from '../../config/database';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { ensureBarcode, ensureVariantBarcode } from '../products/barcode.service';
import {
  getPricingSettings,
  logTrendyolPriceCalc,
  resolveGlobalPriceStrategy as loadTenantPriceStrategy,
  savePricingSettings,
  toPriceStrategy,
} from '../pricing/pricing-settings.service';
import {
  decryptTrendyolCredentials,
  encryptCredential,
} from '../../common/crypto/marketplace-credential.crypto';
import {
  applyTrendyolPriceStrategy,
  type CalculatedPrice,
  type PriceStrategy,
  type ProductPriceOverride,
} from './trendyol-price.util';
import { logBusinessEvent } from '../../common/logging/business-events';
import { trendyolLogger } from '../../common/logging/loggers';

export type { CalculatedPrice, PriceStrategy, ProductPriceOverride };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Extract per-item results from Trendyol batch-request API payloads. */
function extractTrendyolBatchItems(batchResult: any): any[] {
  if (!batchResult) return [];
  if (Array.isArray(batchResult.items)) return batchResult.items;
  if (Array.isArray(batchResult.content)) return batchResult.content;
  if (Array.isArray(batchResult.batchRequestItems)) return batchResult.batchRequestItems;
  return [];
}

/** Trendyol item is OK only when status is SUCCESS and there are no failureReasons. */
function isTrendyolItemSuccess(item: any): boolean {
  const status = String(item?.status ?? '').toUpperCase();
  if (status === 'FAILED' || status === 'REJECTED' || status === 'ERROR') return false;
  if (status !== 'SUCCESS') return false;
  const reasons = [...(item?.failureReasons ?? []), ...(item?.errorMessages ?? [])];
  return reasons.length === 0;
}

/** Human-readable Trendyol failure line(s) with reasonCode when present. */
export function formatTrendyolItemFailure(item: any): string {
  const parts: string[] = [];
  const itemStatus = String(item?.status ?? '').toUpperCase();
  if (itemStatus && itemStatus !== 'SUCCESS') parts.push(`[${itemStatus}]`);

  for (const r of item?.failureReasons ?? []) {
    if (typeof r === 'string') {
      parts.push(r);
      continue;
    }
    const code = r?.reasonCode ?? r?.code;
    const desc = r?.reasonDescription ?? r?.message ?? r?.description;
    if (code && desc) parts.push(`${code}: ${desc}`);
    else if (code) parts.push(String(code));
    else if (desc) parts.push(String(desc));
    else parts.push(JSON.stringify(r));
  }
  for (const m of item?.errorMessages ?? []) parts.push(String(m));
  if (typeof item?.message === 'string' && item.message) parts.push(item.message);
  return parts.filter(Boolean).join(' | ') || 'Trendyol işleme hatası (detay dönmedi)';
}

/** Only products confirmed on Trendyol should be updated via PUT. */
function shouldUpdateViaPut(trendyolStatus: string | null | undefined): boolean {
  return String(trendyolStatus ?? '').toUpperCase() === 'ACTIVE';
}

function trendyolItemBarcode(item: any): string {
  return String(
    item?.requestItem?.barcode
    ?? item?.requestItem?.product?.barcode
    ?? item?.barcode
    ?? '',
  );
}

const TRENDYOL_API_ACCEPTED_MSG =
  'Trendyol API kabul etti. Ürün satıcı panelinde “Onay Bekleyenler”de görünebilir; canlı vitrin onayı sonrasıdır.';

/** Normalize barcode keys for Map lookup (Trendyol may return number or string). */
function normBarcode(bc: string | number | null | undefined): string {
  return String(bc ?? '').trim();
}

function mergeBatchItemsIntoMap(
  items: any[],
  out: Map<string, { ok: boolean; message: string }>,
): void {
  for (const item of items) {
    const bc = normBarcode(trendyolItemBarcode(item));
    if (!bc) continue;
    const ok  = isTrendyolItemSuccess(item);
    const msg = ok ? 'Fiyat & stok güncellendi' : formatTrendyolItemFailure(item);
    out.set(bc, { ok, message: msg });
  }
}

function allBarcodesResolved(barcodes: string[], out: Map<string, { ok: boolean; message: string }>): boolean {
  return barcodes.every(bc => out.has(normBarcode(bc)));
}

/**
 * Poll Trendyol batch for price/stock (ProductInventoryUpdate).
 * Trendyol docs: batch-level status may be empty; rely on items[].
 */
async function pollPriceStockBatchResults(
  client: TrendyolClient,
  batchRequestId: string,
  barcodes: string[],
): Promise<Map<string, { ok: boolean; message: string }>> {
  const out = new Map<string, { ok: boolean; message: string }>();
  const wanted = barcodes.map(normBarcode).filter(Boolean);
  const smallBatch = wanted.length <= 5;
  const MAX_ATTEMPTS = smallBatch ? 40 : 30;
  const INTERVAL_MS  = smallBatch ? 3_000 : 5_000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(INTERVAL_MS);

    let batchResult: any;
    try {
      batchResult = await client.getBatchRequestStatus(batchRequestId);
    } catch (pollErr: any) {
      console.warn(`[PriceStock Poll] attempt ${attempt + 1} error:`, pollErr?.message);
      continue;
    }

    const items       = extractTrendyolBatchItems(batchResult);
    const batchStatus = String(batchResult?.status ?? '').toUpperCase();
    const itemCount   = Number(batchResult?.itemCount ?? items.length);
    const failedCount = Number(batchResult?.failedItemCount ?? 0);

    console.log(
      `[PriceStock Poll] attempt ${attempt + 1}/${MAX_ATTEMPTS} batch=${batchRequestId} ` +
      `status=${batchStatus || '—'} items=${items.length} itemCount=${itemCount} failed=${failedCount}`,
    );

    if (items.length > 0) {
      mergeBatchItemsIntoMap(items, out);
    }

    if (allBarcodesResolved(wanted, out)) return out;

    // Batch finished but some barcodes missing from response
    if (items.length > 0 && (batchStatus === 'COMPLETED' || items.length >= itemCount)) {
      for (const bc of wanted) {
        if (!out.has(bc)) {
          out.set(bc, {
            ok:      false,
            message: '[FAILED] Trendyol yanıtında barkod yok — ürün Trendyol\'da kayıtlı olmayabilir (önce Ürün Gönderme)',
          });
        }
      }
      return out;
    }
  }

  const timeoutMsg =
    `Trendyol isteği kuyruğa alındı (batch: ${batchRequestId}) ancak sonuç ${Math.round((MAX_ATTEMPTS * INTERVAL_MS) / 1000)} sn içinde gelmedi. ` +
    `Trendyol satıcı panelinde barkodu kontrol edin veya birkaç dakika sonra tekrar deneyin.`;
  for (const bc of wanted) {
    if (!out.has(bc)) out.set(bc, { ok: false, message: timeoutMsg });
  }
  return out;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrendyolCredentials {
  supplierId:       string;
  apiKey:           string;
  apiSecret:        string;
  token?:           string;
  integrationCode?: string;
}

/** Local category ID → Trendyol category ID */
export type CategoryMapping = Record<string, string>;

/** Coerce DB / legacy JSON into localCategoryId → trendyolCategoryId strings. */
export function normalizeCategoryMapping(raw: unknown): CategoryMapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CategoryMapping = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof val === 'string' && val.trim()) out[key] = val.trim();
    else if (typeof val === 'number' && Number.isFinite(val)) out[key] = String(val);
    else if (val && typeof val === 'object') {
      const id = (val as { id?: unknown }).id;
      if (id != null && String(id).trim()) out[key] = String(id).trim();
    }
  }
  return out;
}

/** Local brand name → Trendyol brand ID (number) */
export type BrandMapping = Record<string, number>;

export function normalizeBrandMapping(raw: unknown): BrandMapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: BrandMapping = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(val);
    if (key.trim() && !Number.isNaN(n) && n > 0) out[key.trim()] = n;
  }
  return out;
}

/**
 * Resolves Trendyol brandId from product.brand + tenant brand mapping.
 * - Empty product brand → first mapped brand (Marka Eşleştirme varsayılanı)
 * - Single mapping → used for all products (sol kolon etiketi ürün markasıyla eşleşmek zorunda değil)
 * - Multiple mappings → match by exact / case-insensitive key on product.brand
 */
export function resolveTrendyolBrandId(
  productBrand: string | null | undefined,
  brandMapping: BrandMapping,
): { brandId: number | null; usedFallback: boolean } {
  const entries = Object.entries(brandMapping).filter(([, id]) => id != null && Number(id) > 0);
  if (entries.length === 0) return { brandId: null, usedFallback: false };

  const defaultId = Number(entries[0][1]);
  const trimmed   = (productBrand ?? '').trim();

  if (!trimmed) {
    return { brandId: defaultId, usedFallback: true };
  }

  if (brandMapping[trimmed] != null) {
    return { brandId: Number(brandMapping[trimmed]), usedFallback: false };
  }

  const matched = entries.find(([k]) => k.toLowerCase() === trimmed.toLowerCase());
  if (matched) {
    return { brandId: Number(matched[1]), usedFallback: false };
  }

  if (entries.length === 1) {
    return { brandId: defaultId, usedFallback: true };
  }

  return { brandId: null, usedFallback: false };
}

/** Global Trendyol shipping defaults for a tenant */
export interface ShippingDefaults {
  cargoCompanyId:    number;
  deliveryDuration:  number;
  dimensionalWeight: number;
}

/**
 * Global price strategy stored in TrendyolIntegration.priceStrategy
 * mode:           'none'    → send base price as-is
 *                 'percent' → basePrice × (1 + value/100)
 *                 'fixed'   → basePrice + value (in ₺)
 * vatRate:        KDV oranı applied to the final price when computing listPrice (optional)
 * vatIncluded:    if true, basePrice already includes VAT (used for display only)
 * roundTo:        round final price to this precision (default 2)
 */
/** Cargo companies per official Trendyol docs */
export const TRENDYOL_CARGO_COMPANIES = [
  { id: 10, code: 'MNGMP',       name: 'MNG Kargo Marketplace' },
  { id: 4,  code: 'YKMP',        name: 'Yurtiçi Kargo Marketplace' },
  { id: 7,  code: 'ARASMP',      name: 'Aras Kargo Marketplace' },
  { id: 6,  code: 'HOROZMP',     name: 'Horoz Kargo Marketplace' },
  { id: 9,  code: 'SURATMP',     name: 'Sürat Kargo Marketplace' },
  { id: 17, code: 'TEXMP',       name: 'Trendyol Express Marketplace' },
  { id: 19, code: 'PTTMP',       name: 'PTT Kargo Marketplace' },
  { id: 20, code: 'CEVAMP',      name: 'CEVA Marketplace' },
  { id: 30, code: 'CEVATEDARIK', name: 'Ceva Tedarik Marketplace' },
  { id: 38, code: 'SENDEOMP',    name: 'Kolay Gelsin Marketplace' },
] as const;

/**
 * Local attribute ID → Trendyol attribute mapping
 * valueMapping: localValueLabel → trendyolAttributeValueId
 */
export type AttributeMapping = Record<string, {
  trendyolAttributeId:   number;
  trendyolAttributeName: string;
  required:              boolean;
  valueMapping: Record<string, number | string>;
}>;

export type TrendyolProductStatus = 'PENDING' | 'SENT' | 'APPROVED' | 'REJECTED' | 'ERROR' | 'PRICE_SYNCED';

/** Single validation issue — error blocks send; skip = product omitted; warning = informational */
export interface ValidationIssueItem {
  level:   'error' | 'warning' | 'skip';
  code:    string;
  message: string;
  tab:     string | null;   // which TrendyolIntegration tab to navigate to for fixing
  hint?:   string;          // short fix instruction
}

/** Per-product validation report */
export interface ValidationReport {
  productId:   string;
  productName: string;
  canSend:     boolean;       // false = error or category skip; true = warnings only or clean
  issues:      ValidationIssueItem[];
}

export interface ProductWithTrendyolStatus {
  id:            string;
  name:          string;
  barcode:       string | null;
  sku:           string | null;
  status:        string;
  salePrice:     number;
  stock:         number;
  categoryName:  string | null;
  categoryId:    string | null;
  mainImage:     string | null;
  trendyol:      {
    mapped:       boolean;
    status:       TrendyolProductStatus;
    batchId:      string | null;
    lastSyncAt:   string | null;
    errorMessage: string | null;
  };
}

export interface SendResult {
  productId:    string;
  productName:  string;
  status:       'sent' | 'error' | 'skipped';
  message:      string;
  batchId?:     string;
}

export interface SyncResult {
  success:  number;
  failed:   number;
  skipped:  number;
  results:  SendResult[];
  syncHistoryId: string | null;
}

/** Manual price/stock item for override endpoint */
export interface PriceStockItem {
  barcode:    string;
  price:      number;
  stock:      number;
  /** Optional — used to update TrendyolProductMap record */
  productId?: string;
  variantId?: string;
}

export interface PriceStockUpdateResult {
  sent:    number;
  failed:  number;
  items:   Array<{ barcode: string; status: 'ok' | 'error'; message: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClient(integration: { apiKey: string; apiSecret: string; supplierId: string }): TrendyolClient {
  const creds = decryptTrendyolCredentials(integration);
  return new TrendyolClient({
    apiKey:    creds.apiKey,
    apiSecret: creds.apiSecret,
    sellerId:  creds.sellerId,
  });
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TrendyolService {

  // ── INTEGRATION SETUP ────────────────────────────────────────────────────

  async getIntegration(tenantId: string) {
    const integration = await prisma.trendyolIntegration.findFirst({
      where: { tenantId },
    });
    if (!integration) return null;
    return {
      id:               integration.id,
      supplierId:       integration.supplierId,
      apiKey:           integration.apiKey ? '***' : '',
      apiSecret:        integration.apiSecret ? '***' : '',
      token:            integration.token ? '***' : '',
      integrationCode:  (integration as any).integrationCode ?? '',
      isActive:         integration.isActive,
      lastSync:         integration.lastSync,
      categoryMappings: integration.categoryMappings as CategoryMapping,
      attributeMappings: integration.attributeMappings as AttributeMapping,
      createdAt:        integration.createdAt,
    };
  }

  async saveIntegration(tenantId: string, data: TrendyolCredentials) {
    const existing = await prisma.trendyolIntegration.findFirst({
      where: { tenantId },
    });

    const patch: Record<string, unknown> = {
      supplierId: data.supplierId,
      isActive:   true,
      ...(data.integrationCode && data.integrationCode !== '***'
        ? { integrationCode: data.integrationCode }
        : {}),
    };

    if (data.apiKey && data.apiKey !== '***') {
      patch.apiKey = encryptCredential(data.apiKey);
    }
    if (data.apiSecret && data.apiSecret !== '***') {
      patch.apiSecret = encryptCredential(data.apiSecret);
    }
    if (data.token && data.token !== '***') {
      patch.token = encryptCredential(data.token);
    }

    if (existing) {
      return prisma.trendyolIntegration.update({
        where: { id: existing.id },
        data:  patch,
      });
    }

    if (!data.apiKey?.trim() || data.apiKey === '***' || !data.apiSecret?.trim() || data.apiSecret === '***') {
      throw new Error('Yeni entegrasyon için apiKey ve apiSecret zorunludur.');
    }

    return prisma.trendyolIntegration.create({
      data: {
        tenantId,
        supplierId:     data.supplierId,
        apiKey:         encryptCredential(data.apiKey),
        apiSecret:      encryptCredential(data.apiSecret),
        ...(data.token && data.token !== '***' ? { token: encryptCredential(data.token) } : {}),
        ...(data.integrationCode ? { integrationCode: data.integrationCode } : {}),
        isActive: true,
      },
    });
  }

  async testConnection(tenantId: string): Promise<{ success: boolean; message: string }> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) {
      trendyolLogger.warn({ action: 'test_connection', status: 'failure', tenantId, message: 'Integration not found' });
      return { success: false, message: 'Trendyol entegrasyonu bulunamadı. Önce API bilgilerini kaydedin.' };
    }
    try {
      const client = getClient(integration);
      await client.healthCheck();
      trendyolLogger.info({ action: 'test_connection', status: 'success', tenantId });
      return { success: true, message: 'Bağlantı başarılı! Trendyol API erişimi doğrulandı.' };
    } catch (err: any) {
      trendyolLogger.error({ action: 'test_connection', status: 'failure', tenantId, error: err });
      return { success: false, message: err.message ?? 'Bağlantı başarısız.' };
    }
  }

  // ── CATEGORIES ─────────────────────────────────────────────────────────────

  async getTrendyolCategories(tenantId: string) {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);
    return client.getCategories();
  }

  async getTrendyolCategoryAttributes(tenantId: string, trendyolCategoryId: string) {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);
    return client.getCategoryAttributes(trendyolCategoryId);
  }

  // ── MAPPINGS ───────────────────────────────────────────────────────────────

  async getCategoryMapping(tenantId: string): Promise<CategoryMapping> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) return {};
    return normalizeCategoryMapping(integration.categoryMappings);
  }

  async saveCategoryMapping(tenantId: string, mapping: CategoryMapping) {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const normalized  = normalizeCategoryMapping(mapping);
    return prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { categoryMappings: normalized },
    });
  }

  async getAttributeMapping(tenantId: string): Promise<AttributeMapping> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    return (integration?.attributeMappings as AttributeMapping) ?? {};
  }

  async saveAttributeMapping(tenantId: string, mapping: AttributeMapping) {
    const integration = await this._getIntegrationOrThrow(tenantId);
    return prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { attributeMappings: mapping },
    });
  }

  // ── PRODUCTS ───────────────────────────────────────────────────────────────

  async getProductsWithTrendyolStatus(
    tenantId: string,
    query: { page?: number; limit?: number; search?: string; mapped?: 'true' | 'false'; categoryId?: string; onlyMappedCategories?: boolean }
  ): Promise<{ products: ProductWithTrendyolStatus[]; total: number; page: number; totalPages: number }> {
    const { page = 1, limit = 20, search, mapped, categoryId, onlyMappedCategories } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { tenantId };
    if (search?.trim()) {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { sku:     { contains: search, mode: 'insensitive' } },
      ];
    }
    if (mapped === 'true')  where.trendyolMaps = { some: {} };
    if (mapped === 'false') where.trendyolMaps = { none: {} };
    if (categoryId) where.categoryId = categoryId;

    // Optional: restrict list to products in mapped categories only (explicit opt-in)
    if (onlyMappedCategories === true && !categoryId) {
      const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId }, select: { categoryMappings: true } });
      const catMapping  = normalizeCategoryMapping(integration?.categoryMappings);
      const mappedCatIds = Object.keys(catMapping);
      if (mappedCatIds.length > 0) {
        where.categoryId = { in: mappedCatIds };
      }
    }

    const [total, products] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          pricing:     { select: { salePrice: true, discountPrice: true } },
          category:    { select: { id: true, name: true } },
          stock:       { select: { quantity: true } },
          productImages: { select: { url: true }, take: 1, orderBy: { order: 'asc' } },
          trendyolMaps: { select: { batchId: true, trendyolStatus: true, lastSyncAt: true, errorMessage: true } },
        },
      }),
    ]);

    return {
      products: products.map(p => ({
        id:           p.id,
        name:         p.name,
        barcode:      p.barcode ?? null,
        sku:          p.sku     ?? null,
        status:       p.status,
        salePrice:    Number(p.pricing?.salePrice ?? p.price ?? 0),
        stock:        Number(p.stock?.quantity ?? 0),
        categoryName: p.category?.name ?? null,
        categoryId:   p.categoryId     ?? null,
        mainImage:    p.productImages[0]?.url ?? (p.images?.[0] ?? null),
        trendyol: {
          mapped:       (p.trendyolMaps ?? []).length > 0,
          status:       ((p.trendyolMaps ?? [])[0]?.trendyolStatus ?? 'PENDING') as TrendyolProductStatus,
          batchId:      (p.trendyolMaps ?? [])[0]?.batchId       ?? null,
          lastSyncAt:   (p.trendyolMaps ?? [])[0]?.lastSyncAt?.toISOString() ?? null,
          errorMessage: (p.trendyolMaps ?? [])[0]?.errorMessage  ?? null,
        },
      })),
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  /** Returns local categories that are mapped to a Trendyol category, with names. */
  async getMappedLocalCategories(tenantId: string): Promise<{ id: string; name: string; trendyolCatId: string; productCount: number }[]> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) return [];
    const catMapping  = normalizeCategoryMapping(integration.categoryMappings);
    const localCatIds = Object.keys(catMapping);
    if (localCatIds.length === 0) return [];

    const cats = await prisma.category.findMany({
      where: { id: { in: localCatIds }, tenantId },
      select: { id: true, name: true },
    });
    const catById = new Map(cats.map(c => [c.id, c]));

    const counts = await Promise.all(
      localCatIds.map(id => prisma.product.count({ where: { tenantId, categoryId: id } }))
    );

    return localCatIds.map((id, i) => ({
      id,
      name:          catById.get(id)?.name ?? `Kategori (${id.slice(0, 8)}…)`,
      trendyolCatId: catMapping[id],
      productCount:  counts[i],
    }));
  }

  /** Returns all product IDs in a category (or all mapped categories). Used for bulk send. */
  async getProductIdsByCategory(tenantId: string, categoryId?: string): Promise<string[]> {
    const where: any = { tenantId };
    if (categoryId) where.categoryId = categoryId;
    const products = await prisma.product.findMany({ where, select: { id: true } });
    return products.map(p => p.id);
  }

  // ── SEND PRODUCTS ──────────────────────────────────────────────────────────

  // ── VALIDATION ─────────────────────────────────────────────────────────────

  /**
   * Deep pre-flight validation.
   * Checks: barcode, image, price, category mapping, brand mapping,
   *         attribute defaults, cargo info.
   * Returns one entry per product that has ANY issue.
   * Each issue has a `level` (error = blocks send | warning = cautionary).
   */
  async validateProducts(tenantId: string, productIds: string[]): Promise<ValidationReport[]> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });

    const catMapping   = (integration?.categoryMappings  as CategoryMapping)  ?? {};
    const attrDefaults = (integration?.attributeMappings as any)              ?? {};
    const brandMapping = normalizeBrandMapping(integration?.brandMappings);
    const shippingDefs = (integration?.shippingDefaults  as ShippingDefaults) ?? {};
    const hasGlobalCargo = !!(shippingDefs.cargoCompanyId);

    // ── Batch fetch ALL products in ONE query instead of N serial queries ──
    const products = await prisma.product.findMany({
      where:   { id: { in: productIds }, tenantId },
      include: {
        pricing:       { select: { salePrice: true, discountPrice: true } },
        stock:         { select: { quantity: true } },
        shipping:      { select: { cargoCompanyId: true } },
        productImages: { select: { url: true }, take: 1 },
      },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    // Auto-generate missing barcodes in parallel (non-blocking)
    const missingBarcode = products.filter(p => !p.barcode);
    if (missingBarcode.length > 0) {
      await Promise.all(
        missingBarcode.map(p =>
          ensureBarcode({ prisma, productId: p.id, tenantId, currentBarcode: p.barcode }).catch(() => {})
        )
      );
    }

    const out: ValidationReport[] = [];

    for (const productId of productIds) {
      const product = productMap.get(productId);
      if (!product) {
        out.push({ productId, productName: '?', canSend: false, issues: [
          { level: 'error', code: 'NOT_FOUND', message: 'Ürün bulunamadı.', tab: null },
        ]});
        continue;
      }

      const issues: ValidationIssueItem[] = [];

      // ── 1. Image ──────────────────────────────────────────────────────────
      if (!product.productImages || product.productImages.length === 0) {
        issues.push({ level: 'error', code: 'NO_IMAGE',
          message: 'Ürün görseli yok — en az 1 görsel zorunludur.',
          tab: 'product', hint: 'Ürün formundan görsel ekleyin.' });
      }

      // ── 2. Price > 0 ──────────────────────────────────────────────────────
      const salePrice = Number((product as any).pricing?.discountPrice ?? (product as any).pricing?.salePrice ?? 0);
      if (salePrice <= 0) {
        issues.push({ level: 'error', code: 'ZERO_PRICE',
          message: 'Satış fiyatı 0 veya girilmemiş.',
          tab: 'product', hint: 'Ürün formundan fiyat girin.' });
      }

      // ── 3. Category mapping ───────────────────────────────────────────────
      const trendyolCatId = (product as any).categoryId ? catMapping[(product as any).categoryId] : null;
      if (!trendyolCatId) {
        issues.push({ level: 'skip', code: 'NO_CATEGORY_MAP',
          message: 'Kategori eşleştirilmemiş — bu ürün gönderilmeyecek.',
          tab: 'categories', hint: 'Kategori Eşleştirme sekmesinden bu kategoriyi eşleştirin.' });
      }

      // ── 4. Brand mapping ──────────────────────────────────────────────────
      const { brandId: resolvedBrandId, usedFallback: brandFallback } =
        resolveTrendyolBrandId(product.brand, brandMapping);

      if (!resolvedBrandId) {
        issues.push({ level: 'error', code: 'NO_BRAND',
          message: product.brand
            ? `"${product.brand}" markası eşleştirilmemiş ve varsayılan marka yok.`
            : 'Marka eşleştirmesi yapılmamış — Marka Eşleştirme sekmesinden en az bir marka ekleyin.',
          tab: 'brands',
          hint: '"Marka Eşleştirme" sekmesinden Trendyol marka ID\'si kaydedin.' });
      } else if (brandFallback && product.brand?.trim()) {
        issues.push({ level: 'warning', code: 'BRAND_NOT_MAPPED',
          message: `"${product.brand}" eşleşmedi — Marka Eşleştirme'deki marka (ID: ${resolvedBrandId}) kullanılacak.`,
          tab: 'brands', hint: 'Sol kolona bu ürünün marka adını yazarak eşleştirebilirsiniz.' });
      }

      // ── 5. Attribute defaults ─────────────────────────────────────────────
      if (trendyolCatId) {
        const catDefaults = attrDefaults[String(trendyolCatId)] ?? {};
        if (Object.keys(catDefaults).length === 0) {
          issues.push({ level: 'warning', code: 'NO_ATTR_DEFAULTS',
            message: 'Bu kategori için özellik değerleri girilmemiş — bazı alanlar boş gidecek.',
            tab: 'attributes', hint: '"Özellik Değerleri" sekmesinden kategori özelliklerini doldurun.' });
        }
      }

      // ── 6. Cargo info ─────────────────────────────────────────────────────
      const hasProductCargo = !!(product as any).shipping?.cargoCompanyId;
      if (!hasProductCargo && !hasGlobalCargo) {
        issues.push({ level: 'warning', code: 'NO_CARGO',
          message: 'Kargo firması belirlenmemiş — MNG Kargo (ID: 10) kullanılacak.',
          tab: 'setup', hint: 'Bağlantı sekmesindeki "Global Kargo Varsayılanları"nı doldurun.' });
      }

      const canSend = !issues.some(i => i.level === 'error' || i.level === 'skip');
      out.push({ productId, productName: product.name, canSend, issues });
    }

    return out;
  }

  async sendProducts(tenantId: string, productIds: string[]): Promise<SyncResult> {
    trendyolLogger.info({ action: 'send_products', status: 'pending', tenantId, productCount: productIds.length });
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);

    const catMapping      = (integration.categoryMappings  as CategoryMapping)  ?? {};
    const attrMapping     = (integration.attributeMappings as AttributeMapping) ?? {};
    const brandMapping    = normalizeBrandMapping(integration.brandMappings);
    const shippingDefs    = (integration.shippingDefaults  as ShippingDefaults) ?? {};
    const priceStrategy   = await loadTenantPriceStrategy(tenantId);
    const defCargoId      = Number(shippingDefs.cargoCompanyId    ?? 10);
    const defDelivery     = Number(shippingDefs.deliveryDuration  ?? 3);
    const defDimWeight    = Number(shippingDefs.dimensionalWeight ?? 1);

    const results: SendResult[] = [];
    let successCnt = 0, failedCnt = 0, skippedCnt = 0;

    const startedAt = new Date();

    // ── Batch fetch ALL products + price overrides in ONE query each ─────────
    const allProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      include: {
        pricing:     { select: { salePrice: true, discountPrice: true, vatRate: true } },
        stock:       { select: { quantity: true } },
        shipping:    { select: { cargoCompanyId: true, deliveryDuration: true, weight: true, desi: true } },
        productImages: { select: { url: true, isMain: true }, orderBy: { order: 'asc' } },
        attributeValues: {
          include: {
            attribute:      { select: { id: true, name: true } },
            attributeValue: { select: { id: true, label: true } },
          },
        },
        category: { select: { id: true, name: true } },
      },
    });
    const productMap = new Map(allProducts.map(p => [p.id, p]));

    // Pre-fetch all price overrides in one query
    const allPriceOverrides = await prisma.trendyolProductPrice.findMany({
      where: { productId: { in: productIds }, tenantId },
    });
    const priceOverrideMap = new Map(allPriceOverrides.map(r => [r.productId, r]));

    // Auto-generate barcodes for products that are missing them (parallel)
    const missingBarcodeProducts = allProducts.filter(p => !p.barcode);
    if (missingBarcodeProducts.length > 0) {
      const barcodeResults = await Promise.all(
        missingBarcodeProducts.map(p =>
          ensureBarcode({ prisma, productId: p.id, tenantId, currentBarcode: p.barcode }).then(bc => ({ id: p.id, bc })).catch(() => ({ id: p.id, bc: p.barcode }))
        )
      );
      // Update in-memory map with generated barcodes
      for (const { id, bc } of barcodeResults) {
        const p = productMap.get(id);
        if (p && bc) (p as any).barcode = bc;
      }
    }

    for (const productId of productIds) {
      const product = productMap.get(productId);

      if (!product) {
        results.push({ productId, productName: '?', status: 'error', message: 'Ürün bulunamadı.' });
        failedCnt++;
        continue;
      }

      const { brandId: resolvedBrandId } = resolveTrendyolBrandId(product.brand, brandMapping);
      if (!resolvedBrandId) {
        results.push({
          productId,
          productName: product.name,
          status: 'skipped',
          message: product.brand
            ? `"${product.brand}" markası eşleştirilmemiş — Marka Eşleştirme sekmesini kontrol edin.`
            : 'Marka eşleştirmesi yok — Marka Eşleştirme sekmesinden Trendyol marka ID\'si ekleyin.',
        });
        skippedCnt++; continue;
      }

      const trendyolCategoryId = (product as any).categoryId ? catMapping[(product as any).categoryId] : null;
      if (!trendyolCategoryId) {
        results.push({ productId, productName: product.name, status: 'skipped', message: 'Kategori eşleştirilmemiş — Kategori Eşleştirme sekmesini tamamlayın.' });
        skippedCnt++; continue;
      }

      // ── Pricing (with strategy + per-product override) ───────────────────
      const baseSalePrice  = Number((product as any).pricing?.discountPrice ?? (product as any).pricing?.salePrice ?? (product as any).price ?? 0);
      const baseListPrice  = Number((product as any).pricing?.salePrice ?? (product as any).price ?? baseSalePrice);
      const quantity       = Number((product as any).stock?.quantity ?? 0);

      // Use pre-fetched price override from batch map
      const rawOverride    = priceOverrideMap.get(productId) ?? null;
      const priceOverride: ProductPriceOverride | null = rawOverride ? {
        customPrice: rawOverride.customPrice   ? Number(rawOverride.customPrice)   : undefined,
        mode:        (rawOverride.increaseMode ?? undefined) as ProductPriceOverride['mode'],
        value:       rawOverride.increaseValue ? Number(rawOverride.increaseValue) : undefined,
        vatRate:     rawOverride.vatRate ?? undefined,
      } : null;
      const calcPrice      = TrendyolService.applyPriceStrategy(baseSalePrice, baseListPrice, priceStrategy, priceOverride);
      const salePrice      = calcPrice.finalPrice;
      const listPrice      = calcPrice.listPrice;
      const vatRate        = calcPrice.vatRate;

      logTrendyolPriceCalc({
        productId,
        productName: product.name,
        basePrice:   baseSalePrice,
        strategy:    priceStrategy,
        finalPrice:  salePrice,
        listPrice,
      });

      // ── Images — Trendyol format: [{url}], isMain first, max 8 ──────────
      const rawImages = ((product as any).productImages ?? []);
      const sortedImages = [
        ...rawImages.filter((i: any) => i.isMain),
        ...rawImages.filter((i: any) => !i.isMain),
      ];
      const trendyolImages = sortedImages
        .map((i: any) => ({ url: i.url }))
        .filter((i: any) => i.url?.startsWith('http'))
        .slice(0, 8);

      // ── Attributes — built from category-level defaults + per-product mapping ──
      // attributeMappings shape: { [trendyolCategoryId]: { [trendyolAttrId]: value } }
      const trendyolAttributes: Array<{
        attributeId:          number;
        attributeValueId?:    number;
        customAttributeValue?: string;
      }> = [];

      // 1. Category defaults
      const catAttrDefaults: Record<string, any> =
        (attrMapping as any)[String(trendyolCategoryId)] ?? {};

      for (const [attrId, attrValue] of Object.entries(catAttrDefaults)) {
        const numAttrId = Number(attrId);
        const strValue  = String(attrValue ?? '').trim();
        const numValue  = Number(strValue);
        if (!strValue) continue;
        if (!isNaN(numValue) && numValue > 0) {
          trendyolAttributes.push({ attributeId: numAttrId, attributeValueId: numValue });
        } else {
          trendyolAttributes.push({ attributeId: numAttrId, customAttributeValue: strValue });
        }
      }

      // 2. Per-product overrides (old local-UUID-keyed schema)
      for (const av of (product as any).attributeValues ?? []) {
        const mappedAttr = (attrMapping as any)[av.attributeId];
        if (!mappedAttr || typeof mappedAttr !== 'object' || !mappedAttr.trendyolAttributeId) continue;
        const tAttrId    = Number(mappedAttr.trendyolAttributeId);
        const valueLabel = av.attributeValue?.label ?? (av as any).textValue ?? '';
        const mappedVal  = mappedAttr.valueMapping?.[valueLabel];
        const idx        = trendyolAttributes.findIndex(a => a.attributeId === tAttrId);
        const entry = mappedVal !== undefined && mappedVal !== ''
          ? { attributeId: tAttrId, attributeValueId: typeof mappedVal === 'number' ? mappedVal : undefined, customAttributeValue: typeof mappedVal === 'string' ? String(mappedVal) : undefined }
          : { attributeId: tAttrId, customAttributeValue: valueLabel || undefined };
        if (idx >= 0) trendyolAttributes[idx] = entry; else trendyolAttributes.push(entry);
      }

      // ── Build Trendyol v2 product item ───────────────────────────────────
      const resolvedCargoId    = Number((product as any).shipping?.cargoCompanyId    ?? defCargoId);
      const resolvedDelivery   = Number((product as any).shipping?.deliveryDuration  ?? defDelivery);
      const resolvedDimWeight  = Number((product as any).shipping?.desi              ?? defDimWeight);
      const trendyolItem = {
        barcode:           (product as any).barcode,
        title:             product.name.slice(0, 100),
        productMainId:     (product as any).sku ?? (product as any).barcode,
        stockCode:         (product as any).sku ?? (product as any).barcode,
        brandId:           resolvedBrandId,
        categoryId:        Number(trendyolCategoryId),
        quantity,
        dimensionalWeight: resolvedDimWeight || 1,
        description:       (product.description ?? product.name).slice(0, 500),
        currencyType:      'TRY',
        listPrice,
        salePrice,
        vatRate,
        cargoCompanyId:    resolvedCargoId,
        deliveryOption:    { deliveryDuration: resolvedDelivery || 2 },
        images:            trendyolImages,
        attributes:        trendyolAttributes,
      };

      try {
        const response = await client.createProduct(trendyolItem as any);
        const batchId  = (response as any)?.batchRequestId ?? (response as any)?.id ?? null;

        await prisma.trendyolProductMap.upsert({
          where:  { tenantId_productId: { tenantId, productId } },
          create: { tenantId, productId, batchId: String(batchId ?? ''), trendyolStatus: 'SENT', lastSyncAt: new Date(), integrationId: integration.id },
          update: { batchId: String(batchId ?? ''), trendyolStatus: 'SENT', lastSyncAt: new Date(), errorMessage: null },
        });

        results.push({ productId, productName: product.name, status: 'sent', message: 'Trendyol\'a gönderildi', batchId: String(batchId ?? '') });
        successCnt++;
      } catch (err: any) {
        const errMsg = err.message ?? 'Trendyol API hatası';

        await prisma.trendyolProductMap.upsert({
          where:  { tenantId_productId: { tenantId, productId } },
          create: { tenantId, productId, trendyolStatus: 'ERROR', errorMessage: errMsg, integrationId: integration.id },
          update: { trendyolStatus: 'ERROR', errorMessage: errMsg, lastSyncAt: new Date() },
        });

        results.push({ productId, productName: product.name, status: 'error', message: errMsg });
        failedCnt++;
      }
    }

    // Save sync history
    let syncHistoryId: string | null = null;
    try {
      const history = await prisma.integrationSyncHistory.create({
        data: {
          type:           'PRODUCT',
          status:         failedCnt === productIds.length ? 'FAILED' : failedCnt > 0 ? 'PARTIAL' : 'SUCCESS',
          itemsProcessed: successCnt,
          itemsFailed:    failedCnt,
          startedAt,
          completedAt:    new Date(),
          integration:    { connect: { id: integration.id } },
        },
      });
      syncHistoryId = history.id;
    } catch { /* non-blocking */ }

    // Update lastSync
    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { lastSync: new Date() },
    }).catch(() => {});

    const result = { success: successCnt, failed: failedCnt, skipped: skippedCnt, results, syncHistoryId };
    trendyolLogger.info({
      action: 'send_products',
      status: failedCnt > 0 ? (successCnt > 0 ? 'success' : 'failure') : 'success',
      tenantId,
      success: successCnt,
      failed: failedCnt,
      skipped: skippedCnt,
    });

    if (successCnt > 0) {
      logBusinessEvent('product_sent', tenantId, {
        productCount: productIds.length,
        success:      successCnt,
        failed:       failedCnt,
        skipped:      skippedCnt,
        syncHistoryId,
      });
    }

    return result;
  }

  // ── PRICE & STOCK SYNC ─────────────────────────────────────────────────────

  async syncPriceStock(tenantId: string, productIds?: string[]): Promise<SyncResult> {
    trendyolLogger.info({ action: 'sync_price_stock', status: 'pending', tenantId, productCount: productIds?.length ?? 'all' });
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);

    // Get all mapped products (or specific ones)
    const where: any = { tenantId };
    if (productIds?.length) where.productId = { in: productIds };

    const maps = await prisma.trendyolProductMap.findMany({
      where,
      include: {
        product: {
          include: {
            pricing:  { select: { salePrice: true, discountPrice: true } },
            stock:    { select: { quantity: true } },
            variants: {
              where:  { isActive: true },
              select: { id: true, barcode: true, sku: true, price: true, discountPrice: true, stockQuantity: true },
            },
          },
        },
      },
    });

    if (maps.length === 0) {
      return { success: 0, failed: 0, skipped: 0, results: [], syncHistoryId: null };
    }

    const results: SendResult[] = [];
    const startedAt = new Date();

    // Build update items: if product has variants, use variant barcodes; else product barcode
    const expandedUpdates: Array<{
      barcode: string; quantity: number; price: number; listPrice: number;
      productId: string; productName: string;
    }> = [];

    for (const m of maps) {
      const p = m.product as any;
      const hasVariants = p.variants && p.variants.length > 0;

      if (hasVariants) {
        // Use variant-level barcode / price / stock — auto-generate if missing
        for (const v of p.variants) {
          const vBarcode = await ensureVariantBarcode({
            prisma,
            variantId:      v.id,
            productId:      m.productId,
            tenantId,
            currentBarcode: v.barcode,
          });
          const vSale = Number(v.discountPrice ?? v.price ?? p.pricing?.discountPrice ?? p.pricing?.salePrice ?? 0);
          const vList = Number(v.price ?? p.pricing?.salePrice ?? vSale);
          expandedUpdates.push({
            barcode:     vBarcode,
            quantity:    Number(v.stockQuantity ?? 0),
            price:       vSale,
            listPrice:   Math.max(vList, vSale),
            productId:   m.productId,
            productName: `${p.name} (${v.sku ?? vBarcode})`,
          });
        }
      } else {
        const pBarcode = await ensureBarcode({
          prisma,
          productId:      m.productId,
          tenantId,
          currentBarcode: p.barcode,
        });
        const sale = Number(p.pricing?.discountPrice ?? p.pricing?.salePrice ?? p.price ?? 0);
        const list = Number(p.pricing?.salePrice ?? p.price ?? sale);
        expandedUpdates.push({
          barcode:     pBarcode,
          quantity:    Number(p.stock?.quantity ?? 0),
          price:       sale,
          listPrice:   Math.max(list, sale),
          productId:   m.productId,
          productName: p.name,
        });
      }
    }

    const updates = expandedUpdates;

    // Trendyol allows batch price+inventory updates (up to 100 per request)
    const BATCH = 100;
    let successCnt = 0, failedCnt = 0;

    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      try {
        const response = await client.updateStockAndPrice(
          batch.map(u => ({ barcode: u.barcode, quantity: u.quantity, price: u.price, listPrice: u.listPrice })),
        );
        const trendyolBatch = String(response.batchRequestId ?? response.id ?? '');
        if (!trendyolBatch) {
          throw new Error('Trendyol batchRequestId dönmedi');
        }

        const perBarcode = await pollPriceStockBatchResults(
          client, trendyolBatch, batch.map(u => u.barcode),
        );

        for (const u of batch) {
          const r = perBarcode.get(normBarcode(u.barcode)) ?? { ok: false, message: 'Trendyol yanıtında barkod bulunamadı' };
          if (r.ok) {
            await prisma.trendyolProductMap.updateMany({
              where: { tenantId, productId: u.productId },
              data:  { trendyolStatus: 'PRICE_SYNCED', lastSyncAt: new Date(), errorMessage: null },
            }).catch(() => {});
            results.push({ productId: u.productId, productName: u.productName, status: 'sent', message: r.message });
            successCnt++;
          } else {
            await prisma.trendyolProductMap.updateMany({
              where: { tenantId, productId: u.productId },
              data:  { errorMessage: r.message, lastSyncAt: new Date() },
            }).catch(() => {});
            results.push({ productId: u.productId, productName: u.productName, status: 'error', message: r.message });
            failedCnt++;
          }
        }
      } catch (err: any) {
        const errMsg = err.message ?? 'Trendyol API hatası';
        for (const u of batch) {
          await prisma.trendyolProductMap.updateMany({
            where: { tenantId, productId: u.productId },
            data:  { errorMessage: errMsg, lastSyncAt: new Date() },
          }).catch(() => {});
          results.push({ productId: u.productId, productName: u.productName, status: 'error', message: errMsg });
          failedCnt++;
        }
      }
    }

    let syncHistoryId: string | null = null;
    try {
      const history = await prisma.integrationSyncHistory.create({
        data: {
          type:           'STOCK',
          status:         failedCnt === updates.length ? 'FAILED' : failedCnt > 0 ? 'PARTIAL' : 'SUCCESS',
          itemsProcessed: successCnt,
          itemsFailed:    failedCnt,
          startedAt,
          completedAt:    new Date(),
          integration:    { connect: { id: integration.id } },
        },
      });
      syncHistoryId = history.id;
    } catch { /* non-blocking */ }

    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { lastSync: new Date() },
    }).catch(() => {});

    const priceStockResult = { success: successCnt, failed: failedCnt, skipped: 0, results, syncHistoryId };
    trendyolLogger.info({
      action:  'sync_price_stock',
      status:  failedCnt > 0 ? (successCnt > 0 ? 'success' : 'failure') : 'success',
      tenantId,
      success: successCnt,
      failed:  failedCnt,
    });
    return priceStockResult;
  }

  // ── MANUAL PRICE/STOCK UPDATE ─────────────────────────────────────────────
  /**
   * POST /trendyol/price-stock-update
   * Accepts explicit {barcode, price, stock} items — caller provides the values.
   * Also updates TrendyolProductMap if productId is provided.
   */
  async manualPriceStockUpdate(tenantId: string, items: PriceStockItem[]): Promise<PriceStockUpdateResult> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);

    const resultItems: PriceStockUpdateResult['items'] = [];
    let sent = 0, failed = 0;

    // Batch up to 100 items per Trendyol call
    const BATCH = 100;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const payload = batch.map(it => ({
        barcode:   it.barcode,
        quantity:  Math.max(0, Math.round(it.stock)),
        price:     Math.max(0, it.price),
        listPrice: Math.max(0, it.listPrice ?? it.price),
      }));

      try {
        const response = await client.updateStockAndPrice(payload);
        const trendyolBatch = String(response.batchRequestId ?? response.id ?? '');
        if (!trendyolBatch) throw new Error('Trendyol batchRequestId dönmedi');

        const perBarcode = await pollPriceStockBatchResults(
          client, trendyolBatch, batch.map(it => it.barcode),
        );

        for (const it of batch) {
          const r = perBarcode.get(normBarcode(it.barcode)) ?? { ok: false, message: 'Trendyol yanıtında barkod bulunamadı' };
          if (r.ok) {
            if (it.productId) {
              await prisma.trendyolProductMap.updateMany({
                where: { tenantId, productId: it.productId },
                data:  { trendyolStatus: 'PRICE_SYNCED', lastSyncAt: new Date(), errorMessage: null },
              }).catch(() => {});
            }
            resultItems.push({ barcode: it.barcode, status: 'ok', message: r.message });
            sent++;
          } else {
            if (it.productId) {
              await prisma.trendyolProductMap.updateMany({
                where: { tenantId, productId: it.productId },
                data:  { errorMessage: r.message, lastSyncAt: new Date() },
              }).catch(() => {});
            }
            resultItems.push({ barcode: it.barcode, status: 'error', message: r.message });
            failed++;
          }
        }
      } catch (err: any) {
        const errMsg = err.message ?? 'Trendyol API hatası';
        for (const it of batch) {
          if (it.productId) {
            await prisma.trendyolProductMap.updateMany({
              where: { tenantId, productId: it.productId },
              data:  { errorMessage: errMsg, lastSyncAt: new Date() },
            }).catch(() => {});
          }
          resultItems.push({ barcode: it.barcode, status: 'error', message: errMsg });
          failed++;
        }
      }
    }

    // Save sync history
    try {
      await prisma.integrationSyncHistory.create({
        data: {
          type:           'STOCK',
          status:         failed === items.length ? 'FAILED' : failed > 0 ? 'PARTIAL' : 'SUCCESS',
          itemsProcessed: sent,
          itemsFailed:    failed,
          startedAt:      new Date(),
          completedAt:    new Date(),
          integration:    { connect: { id: integration.id } },
        },
      });
    } catch { /* non-blocking */ }

    return { sent, failed, items: resultItems };
  }

  // ── GET PRODUCTS WITH VARIANTS ────────────────────────────────────────────
  /**
   * Returns mapped products with their variants for the sync UI.
   * Each product row contains a `variants` array with barcode/price/stock.
   */
  async getMappedProductsWithVariants(
    tenantId: string,
    opts?: { search?: string; page?: number; limit?: number },
  ) {
    const page  = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
    const skip  = (page - 1) * limit;

    const search = opts?.search?.trim();
    const where: {
      tenantId: string;
      product?: {
        OR: Array<
          | { name: { contains: string; mode: 'insensitive' } }
          | { sku: { contains: string; mode: 'insensitive' } }
          | { barcode: { contains: string; mode: 'insensitive' } }
        >;
      };
    } = { tenantId };

    if (search) {
      where.product = {
        OR: [
          { name:    { contains: search, mode: 'insensitive' } },
          { sku:     { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const include = {
      product: {
        include: {
          pricing:  { select: { salePrice: true, discountPrice: true, vatRate: true } },
          stock:    { select: { quantity: true } },
          variants: {
            where: { isActive: true },
            select: {
              id:            true,
              name:          true,
              sku:           true,
              barcode:       true,
              price:         true,
              discountPrice: true,
              stockQuantity: true,
              variantAttributes: {
                select: {
                  attribute:      { select: { name: true } },
                  attributeValue: { select: { label: true } },
                },
              },
            },
          },
        },
      },
    } as const;

    const [total, maps] = await prisma.$transaction([
      prisma.trendyolProductMap.count({ where }),
      prisma.trendyolProductMap.findMany({
        where,
        include,
        orderBy: { lastSyncAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items = maps.filter(m => m.product != null).map(m => {
      const p = m.product!;
      const basePrice = Number(p.pricing?.discountPrice ?? p.pricing?.salePrice ?? (p as any).price ?? 0);
      const baseStock = Number(p.stock?.quantity ?? 0);

      const variants = (p.variants ?? []).map(v => {
        // Build display name from variant's own name or its attributes
        let label = v.name ?? '';
        if (!label && v.variantAttributes?.length) {
          label = v.variantAttributes
            .map(va => `${va.attribute?.name ?? ''}: ${va.attributeValue?.label ?? ''}`)
            .join(' / ');
        }
        if (!label) label = v.sku ?? v.barcode ?? v.id;

        return {
          id:          v.id,
          label,
          barcode:     v.barcode ?? '',
          sku:         v.sku ?? '',
          price:       Number(v.discountPrice ?? v.price ?? basePrice),
          stock:       Number(v.stockQuantity ?? 0),
        };
      });

      return {
        productId:    m.productId,
        productName:  p.name,
        barcode:      (p as any).barcode ?? '',
        sku:          (p as any).sku ?? '',
        salePrice:    basePrice,
        stock:        baseStock,
        lastSyncAt:   m.lastSyncAt?.toISOString() ?? null,
        trendyolStatus: m.trendyolStatus as TrendyolProductStatus,
        errorMessage: m.errorMessage ?? null,
        hasVariants:  variants.length > 0,
        variants,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ── REMOVE PRODUCT MAP ─────────────────────────────────────────────────────

  async removeProductMap(tenantId: string, productId: string) {
    return prisma.trendyolProductMap.deleteMany({ where: { tenantId, productId } });
  }

  // ── SYNC HISTORY ───────────────────────────────────────────────────────────

  async getSyncHistory(tenantId: string) {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) return [];
    return prisma.integrationSyncHistory.findMany({
      where:   { integrationId: integration.id },
      orderBy: { startedAt: 'desc' },
      take:    30,
    });
  }

  // ── STATS ──────────────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) return { connected: false };

    const [total, sent, errors, totalProducts] = await prisma.$transaction([
      prisma.trendyolProductMap.count({ where: { tenantId } }),
      prisma.trendyolProductMap.count({ where: { tenantId, trendyolStatus: { in: ['SENT', 'APPROVED', 'PRICE_SYNCED'] } } }),
      prisma.trendyolProductMap.count({ where: { tenantId, trendyolStatus: 'ERROR' } }),
      prisma.product.count({ where: { tenantId } }),
    ]);

    return {
      connected:     true,
      supplierId:    integration.supplierId,
      isActive:      integration.isActive,
      lastSync:      integration.lastSync,
      total,
      sent,
      errors,
      unmapped:      totalProducts - total,
      totalProducts,
    };
  }

  // ── BRAND MAPPING ──────────────────────────────────────────────────────────

  /** Fetch Trendyol brands (with optional name search) */
  async getTrendyolBrands(tenantId: string, search?: string): Promise<Array<{ id: number; name: string }>> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client = getClient(integration);
    return client.getBrands(search);
  }

  /** Create a new brand on Trendyol and return it */
  async createTrendyolBrand(tenantId: string, name: string): Promise<{ id: number; name: string }> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client = getClient(integration);
    return client.createBrand(name);
  }

  /** Get currently saved brand mapping for this tenant */
  async getBrandMapping(tenantId: string): Promise<BrandMapping> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    return normalizeBrandMapping(integration?.brandMappings);
  }

  /** Persist brand mapping */
  async saveBrandMapping(tenantId: string, mapping: BrandMapping): Promise<void> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { brandMappings: mapping as any },
    });
  }

  /** Unique local brand names from products belonging to this tenant */
  async getLocalBrands(tenantId: string): Promise<string[]> {
    const rows = await prisma.product.findMany({
      where:   { tenantId, brand: { not: null } },
      select:  { brand: true },
      distinct: ['brand'],
    });
    return rows.map(r => r.brand!).filter(Boolean).sort((a, b) => a.localeCompare(b, 'tr'));
  }

  // ── SHIPPING DEFAULTS ──────────────────────────────────────────────────────

  async getShippingDefaults(tenantId: string): Promise<ShippingDefaults> {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    const saved = (integration?.shippingDefaults as any) ?? {};
    return {
      cargoCompanyId:    Number(saved.cargoCompanyId    ?? 10),
      deliveryDuration:  Number(saved.deliveryDuration  ?? 3),
      dimensionalWeight: Number(saved.dimensionalWeight ?? 1),
    };
  }

  async saveShippingDefaults(tenantId: string, defaults: Partial<ShippingDefaults>): Promise<void> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const current = (integration.shippingDefaults as any) ?? {};
    const merged  = { ...current, ...defaults };
    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { shippingDefaults: merged },
    });
  }

  // ── Price Strategy ──────────────────────────────────────────────────────────

  /**
   * Pure price calculation — no side-effects.
   * Returns finalPrice (sent to Trendyol) and the effective vatRate.
   */
  static applyPriceStrategy(
    basePrice: number,
    listPrice: number,
    strategy: Partial<PriceStrategy>,
    override: ProductPriceOverride | null,
  ): CalculatedPrice {
    return applyTrendyolPriceStrategy(basePrice, listPrice, strategy, override);
  }

  async getPriceStrategy(tenantId: string): Promise<PriceStrategy> {
    const dto = await getPricingSettings(tenantId);
    return toPriceStrategy(dto) as PriceStrategy;
  }

  async savePriceStrategy(tenantId: string, strategy: Partial<PriceStrategy>): Promise<PriceStrategy> {
    const dto = await savePricingSettings(tenantId, {
      mode:        strategy.mode,
      value:       strategy.value,
      vatRate:     strategy.vatRate,
      vatIncluded: strategy.vatIncluded,
      rounding:    strategy.roundTo,
    });
    return toPriceStrategy(dto) as PriceStrategy;
  }

  async getProductPriceOverride(tenantId: string, productId: string): Promise<ProductPriceOverride | null> {
    const row = await prisma.trendyolProductPrice.findUnique({ where: { productId } });
    if (!row || row.tenantId !== tenantId) return null;
    return {
      customPrice:   row.customPrice   ? Number(row.customPrice)   : undefined,
      mode:          (row.increaseMode ?? undefined) as ProductPriceOverride['mode'],
      value:         row.increaseValue ? Number(row.increaseValue) : undefined,
      vatRate:       row.vatRate ?? undefined,
    };
  }

  async saveProductPriceOverride(
    tenantId:  string,
    productId: string,
    override:  ProductPriceOverride,
  ): Promise<ProductPriceOverride> {
    const data = {
      tenantId,
      productId,
      customPrice:   override.customPrice   != null ? override.customPrice   : null,
      increaseMode:  override.mode          ?? null,
      increaseValue: override.value         != null ? override.value         : null,
      vatRate:       override.vatRate       ?? null,
    };
    await prisma.trendyolProductPrice.upsert({
      where:  { productId },
      create: data,
      update: { ...data, updatedAt: new Date() },
    });
    return override;
  }

  async deleteProductPriceOverride(tenantId: string, productId: string): Promise<void> {
    await prisma.trendyolProductPrice.deleteMany({ where: { tenantId, productId } });
  }

  // ── Local categories (for mapping UI) ─────────────────────────────────────

  async getLocalCategories(tenantId: string) {
    return prisma.category.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, path: true, level: true, parentId: true },
      orderBy: { path: 'asc' },
    });
  }

  async getLocalAttributes(tenantId: string) {
    return prisma.attribute.findMany({
      where:  { tenantId },
      select: { id: true, name: true, type: true, values: { select: { id: true, label: true } } },
    });
  }

  // ── BULK SEND (queue-based, async, with logs) ──────────────────────────────

  /**
   * Sends products one-by-one with rate limiting.
   * Updates the in-memory batchStore after each product.
   * Writes an IntegrationLog record for every attempt.
   * MUST be called without await (fire-and-forget) from the controller.
   */
  async sendProductsBulk(tenantId: string, productIds: string[], batchId: string): Promise<void> {
    const { batchStore, sleep } = await import('./trendyol.queue');

    batchStore.setRunning(batchId);
    const batch = batchStore.get(batchId)!;

    let integration: any;
    try {
      integration = await this._getIntegrationOrThrow(tenantId);
    } catch (err: any) {
      // Mark all as error
      for (const pid of productIds) {
        batchStore.updateResult(batchId, pid, { status: 'error', message: err.message });
        await prisma.integrationLog.create({
          data: { tenantId, productId: pid, productName: '', batchId, status: 'error', message: err.message },
        }).catch(() => {});
      }
      return;
    }

    const client          = getClient(integration);
    const catMapping      = (integration.categoryMappings  as CategoryMapping)  ?? {};
    const attrMapping     = (integration.attributeMappings as AttributeMapping) ?? {};
    const brandMapping    = normalizeBrandMapping(integration.brandMappings);
    const priceStrategy2  = await loadTenantPriceStrategy(tenantId);

    const shippingDefs2  = (integration.shippingDefaults as ShippingDefaults) ?? {};
    const defCargoId2    = Number(shippingDefs2.cargoCompanyId    ?? 10);
    const defDelivery2   = Number(shippingDefs2.deliveryDuration  ?? 3);
    const defDimWeight2  = Number(shippingDefs2.dimensionalWeight ?? 1);

    // ── Batch fetch ALL products + price overrides upfront ────────────────
    const bulkProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      include: {
        pricing:     { select: { salePrice: true, discountPrice: true, vatRate: true } },
        stock:       { select: { quantity: true } },
        shipping:    { select: { cargoCompanyId: true, deliveryDuration: true, weight: true, desi: true } },
        productImages: { select: { url: true, isMain: true }, orderBy: { order: 'asc' } },
        attributeValues: {
          include: {
            attribute:      { select: { id: true, name: true } },
            attributeValue: { select: { id: true, label: true } },
          },
        },
        category: { select: { id: true, name: true } },
      },
    });
    const bulkProductMap = new Map(bulkProducts.map(p => [p.id, p]));

    // Pre-fetch all price overrides
    const bulkPriceOverrides = await prisma.trendyolProductPrice.findMany({
      where: { productId: { in: productIds }, tenantId },
    });
    const bulkPriceOverrideMap = new Map(bulkPriceOverrides.map(r => [r.productId, r]));

    // Batch generate barcodes for products missing them
    const missingBcProducts = bulkProducts.filter(p => !p.barcode);
    if (missingBcProducts.length > 0) {
      const bcResults = await Promise.all(
        missingBcProducts.map(p =>
          ensureBarcode({ prisma, productId: p.id, tenantId, currentBarcode: p.barcode })
            .then(bc => ({ id: p.id, bc })).catch(() => ({ id: p.id, bc: p.barcode }))
        )
      );
      for (const { id, bc } of bcResults) {
        const p = bulkProductMap.get(id);
        if (p && bc) (p as any).barcode = bc;
      }
    }

    // ── PHASE 1: Build all payloads in memory (no API calls) ────────────────
    // Items ready to send to Trendyol
    type ReadyItem = { productId: string; productName: string; payload: any };
    const readyItems: ReadyItem[] = [];

    for (const productId of productIds) {
      const product = bulkProductMap.get(productId);

      if (!product) {
        batchStore.updateResult(batchId, productId, { status: 'error', productName: '?', message: 'Ürün bulunamadı.' });
        await prisma.integrationLog.create({
          data: { tenantId, productId, productName: '?', batchId, status: 'error', message: 'Ürün bulunamadı.' },
        }).catch(() => {});
        continue;
      }

      batchStore.markSending(batchId, productId, product.name);

      const effectiveBarcode   = (product as any).barcode;
      const trendyolCategoryId = (product as any).categoryId ? catMapping[(product as any).categoryId] : null;

      if (!trendyolCategoryId) {
        const msg = 'Kategori eşleştirilmemiş — önce Kategori Eşleştirme sekmesini tamamlayın.';
        batchStore.updateResult(batchId, productId, { status: 'skipped', productName: product.name, message: msg });
        await prisma.integrationLog.create({
          data: { tenantId, productId, productName: product.name, batchId, status: 'skipped', message: msg },
        }).catch(() => {});
        continue;
      }

      const { brandId: resolvedBrandId } = resolveTrendyolBrandId(product.brand, brandMapping);

      if (!resolvedBrandId) {
        const msg = product.brand
          ? `"${product.brand}" markası eşleştirilmemiş — Marka Eşleştirme sekmesini kontrol edin.`
          : 'Marka eşleştirmesi yok — Marka Eşleştirme sekmesinden Trendyol marka ID\'si ekleyin.';
        batchStore.updateResult(batchId, productId, { status: 'skipped', productName: product.name, message: msg });
        await prisma.integrationLog.create({
          data: { tenantId, productId, productName: product.name, batchId, status: 'skipped', message: msg },
        }).catch(() => {});
        continue;
      }

      // Pricing
      const baseSalePrice2 = Number((product as any).pricing?.discountPrice ?? (product as any).pricing?.salePrice ?? (product as any).price ?? 0);
      const baseListPrice2 = Number((product as any).pricing?.salePrice ?? (product as any).price ?? baseSalePrice2);
      const quantity       = Number((product as any).stock?.quantity ?? 0);
      const rawOverride2   = bulkPriceOverrideMap.get(productId) ?? null;
      const priceOverride2: ProductPriceOverride | null = rawOverride2 ? {
        customPrice: rawOverride2.customPrice   ? Number(rawOverride2.customPrice)   : undefined,
        mode:        (rawOverride2.increaseMode ?? undefined) as ProductPriceOverride['mode'],
        value:       rawOverride2.increaseValue ? Number(rawOverride2.increaseValue) : undefined,
        vatRate:     rawOverride2.vatRate ?? undefined,
      } : null;
      const calcPrice2     = TrendyolService.applyPriceStrategy(baseSalePrice2, baseListPrice2, priceStrategy2, priceOverride2);

      logTrendyolPriceCalc({
        productId,
        productName: product.name,
        basePrice:   baseSalePrice2,
        strategy:    priceStrategy2,
        finalPrice:  calcPrice2.finalPrice,
        listPrice:   calcPrice2.listPrice,
      });

      // Images
      const rawImages    = (product as any).productImages ?? [];
      const sortedImages = [...rawImages.filter((i: any) => i.isMain), ...rawImages.filter((i: any) => !i.isMain)];
      const trendyolImages = sortedImages.map((i: any) => ({ url: i.url })).filter((i: any) => i.url?.startsWith('http')).slice(0, 8);

      // Attributes
      const trendyolAttributes: Array<{ attributeId: number; attributeValueId?: number; customAttributeValue?: string }> = [];
      const categoryAttrDefaults: Record<string, any> = (attrMapping as any)[String(trendyolCategoryId)] ?? {};
      for (const [attrId, attrValue] of Object.entries(categoryAttrDefaults)) {
        const numAttrId = Number(attrId);
        const strValue  = String(attrValue ?? '').trim();
        const numValue  = Number(strValue);
        if (!strValue) continue;
        if (!isNaN(numValue) && numValue > 0) {
          trendyolAttributes.push({ attributeId: numAttrId, attributeValueId: numValue });
        } else {
          trendyolAttributes.push({ attributeId: numAttrId, customAttributeValue: strValue });
        }
      }
      for (const av of (product as any).attributeValues ?? []) {
        const mappedAttr = (attrMapping as any)[av.attributeId];
        if (!mappedAttr || typeof mappedAttr !== 'object' || !mappedAttr.trendyolAttributeId) continue;
        const tAttrId    = Number(mappedAttr.trendyolAttributeId);
        const valueLabel = av.attributeValue?.label ?? '';
        const mappedVal  = mappedAttr.valueMapping?.[valueLabel];
        const idx = trendyolAttributes.findIndex(a => a.attributeId === tAttrId);
        const entry = mappedVal !== undefined && mappedVal !== ''
          ? { attributeId: tAttrId, attributeValueId: typeof mappedVal === 'number' ? mappedVal : undefined, customAttributeValue: typeof mappedVal === 'string' ? String(mappedVal) : undefined }
          : { attributeId: tAttrId, customAttributeValue: valueLabel || undefined };
        if (idx >= 0) trendyolAttributes[idx] = entry; else trendyolAttributes.push(entry);
      }

      // Shipping
      const resolvedCargoId2  = Number((product as any).shipping?.cargoCompanyId   ?? defCargoId2);
      const resolvedDelivery2 = Number((product as any).shipping?.deliveryDuration ?? defDelivery2);
      const resolvedDimWt2    = Number((product as any).shipping?.desi             ?? defDimWeight2);

      readyItems.push({
        productId,
        productName: product.name,
        payload: {
          barcode:           effectiveBarcode,
          title:             product.name.slice(0, 100),
          productMainId:     (product as any).sku ?? effectiveBarcode,
          stockCode:         (product as any).sku ?? effectiveBarcode,
          brandId:           resolvedBrandId,
          categoryId:        Number(trendyolCategoryId),
          quantity,
          dimensionalWeight: resolvedDimWt2 || 1,
          description:       (product.description ?? product.name).slice(0, 500),
          currencyType:      'TRY',
          listPrice:         calcPrice2.listPrice,
          salePrice:         calcPrice2.finalPrice,
          vatRate:           calcPrice2.vatRate,
          cargoCompanyId:    resolvedCargoId2,
          deliveryOption:    { deliveryDuration: resolvedDelivery2 || 2 },
          images:            trendyolImages,
          attributes:        trendyolAttributes,
        },
      });
    }

    // ── PHASE 2: PUT yalnızca Trendyol'da gerçekten var olan (ACTIVE) ürünler için
    // Yerel SENT/ERROR kaydı ≠ Trendyol'da ürün var — aksi halde POST ile oluşturulmalı
    const allReadyIds = readyItems.map(r => r.productId);
    const existingMaps = await prisma.trendyolProductMap.findMany({
      where: { productId: { in: allReadyIds }, tenantId },
      select: { productId: true, trendyolStatus: true },
    });
    const putProductIds = new Set(
      existingMaps.filter(m => shouldUpdateViaPut(m.trendyolStatus)).map(m => m.productId),
    );
    console.log(`[BulkSend] ${putProductIds.size} ürün PUT (Trendyol'da kayıtlı), ${allReadyIds.length - putProductIds.size} ürün POST (yeni oluşturma)`);

    // ── PHASE 3: Send to Trendyol ────────────────────────────────────────────
    // KEY RULE: Trendyol allows only ONE active PUT batch at a time.
    // Strategy:
    //   • Existing items (PUT)  → send ALL in a single PUT call (max 1000, Trendyol's limit)
    //   • New items    (POST)   → send in chunks of 50 AFTER the PUT batch is dispatched
    //   • Never interleave PUT and POST

    const newItems      = readyItems.filter(c => !putProductIds.has(c.productId));
    const existingItems = readyItems.filter(c =>  putProductIds.has(c.productId));
    console.log(`[BulkSend] ${existingItems.length} PUT + ${newItems.length} POST gönderilecek`);

    const pollTasks: Promise<void>[] = [];

    // ── Helper: log result for a sub-batch ──────────────────────────────────
    const handleBatchResult = async (subChunk: ReadyItem[], response: any, method: 'POST' | 'PUT') => {
      const trendyolBatch = String((response as any)?.batchRequestId ?? (response as any)?.id ?? '');
      console.log(`[BulkSend] ${method}: ${subChunk.length} ürün → Trendyol batchId: ${trendyolBatch}`);

      await Promise.all(subChunk.map(async ({ productId, productName, payload }) => {
        await prisma.trendyolProductMap.upsert({
          where:  { tenantId_productId: { tenantId, productId } },
          create: { tenantId, productId, batchId: trendyolBatch, trendyolStatus: 'SENT', lastSyncAt: new Date(), integrationId: integration.id },
          update: { batchId: trendyolBatch, trendyolStatus: 'SENT', lastSyncAt: new Date(), errorMessage: null },
        }).catch(() => {});

        batchStore.updateResult(batchId, productId, {
          status: 'sending', productName,
          message: `Trendyol işleniyor (${method})…`,
          trendyolBatchId: trendyolBatch,
          barcode: String(payload?.barcode ?? ''),
        });

        await prisma.integrationLog.create({
          data: { tenantId, productId, productName, batchId, status: 'pending', message: `Trendyol batch kuyruğunda (${method}): ${trendyolBatch}`, requestPayload: payload as any, responsePayload: response as any },
        }).catch(() => {});
      }));

      if (trendyolBatch) {
        pollTasks.push(
          this._pollTrendyolBatchResultForChunk(client, tenantId, subChunk, batchId, trendyolBatch, integration.id)
            .catch(e => console.warn('[Trendyol] Batch poll failed:', e?.message)),
        );
      } else {
        for (const { productId, productName } of subChunk) {
          batchStore.updateResult(batchId, productId, {
            status: 'error', productName, message: 'Trendyol batch ID dönmedi — API yanıtını kontrol edin.',
          });
        }
      }
    };

    const handleBatchError = async (subChunk: ReadyItem[], err: any, method: 'POST' | 'PUT') => {
      const trendyolErrors = err.response?.data?.errors ?? err.response?.data?.message;
      const errMsg: string = Array.isArray(trendyolErrors)
        ? trendyolErrors.map((e: any) => e.message ?? e).join('; ')
        : (typeof trendyolErrors === 'string' ? trendyolErrors : null)
          ?? err.trendyolMessage ?? err.message ?? 'Trendyol API hatası';
      const isRecurring = errMsg.toLowerCase().includes('recurring') || errMsg.toLowerCase().includes('tekrarlı');

      console.error(`[BulkSend] ${method} hata: ${errMsg}`);

      // "tekrarlı güncelleme" → Trendyol has a pending batch; wait 60s and retry once
      if (isRecurring && method === 'PUT') {
        console.warn(`[BulkSend] Trendyol tekrarlı güncelleme hatası — 60 saniye bekleniyor, sonra tekrar denenecek`);
        await sleep(60_000);
        try {
          const retryResp = await client.updateProducts(subChunk.map(c => c.payload) as any);
          await handleBatchResult(subChunk, retryResp, 'PUT');
          return;
        } catch (retryErr: any) {
          console.error(`[BulkSend] PUT retry de başarısız: ${retryErr.message}`);
        }
      }

      await Promise.all(subChunk.map(async ({ productId, productName, payload }) => {
        await prisma.trendyolProductMap.upsert({
          where:  { tenantId_productId: { tenantId, productId } },
          create: { tenantId, productId, trendyolStatus: 'ERROR', errorMessage: errMsg, integrationId: integration.id },
          update: { trendyolStatus: 'ERROR', errorMessage: errMsg, lastSyncAt: new Date() },
        }).catch(() => {});
        batchStore.updateResult(batchId, productId, { status: 'error', productName, message: errMsg });
        await prisma.integrationLog.create({
          data: { tenantId, productId, productName, batchId, status: 'error', message: errMsg, requestPayload: payload as any, responsePayload: err.response?.data ?? { error: err.message } },
        }).catch(() => {});
      }));
    };

    // ── 1. Send ALL existing items with one PUT (Trendyol: 1 active PUT at a time) ──
    if (existingItems.length > 0) {
      try {
        const response = await client.updateProducts(existingItems.map(c => c.payload) as any);
        await handleBatchResult(existingItems, response, 'PUT');
      } catch (err: any) {
        await handleBatchError(existingItems, err, 'PUT');
      }
    }

    // ── 2. Send new items with POST in chunks of 50 ──────────────────────────
    // POST (create) allows concurrent batches, so chunking is fine here
    const POST_CHUNK = 50;
    for (let i = 0; i < newItems.length; i += POST_CHUNK) {
      const chunk = newItems.slice(i, i + POST_CHUNK);
      try {
        const response = await client.createProduct(chunk.map(c => c.payload) as any);
        await handleBatchResult(chunk, response, 'POST');
      } catch (err: any) {
        const isBarcode = JSON.stringify(err.response?.data ?? '').toLowerCase().includes('barkod');
        if (isBarcode) {
          // Barcode exists → retry whole chunk as PUT
          console.warn(`[BulkSend] POST "Aynı barkodlu" → PUT ile tekrar deneniyor (${chunk.length} ürün)`);
          try {
            const putResp = await client.updateProducts(chunk.map(c => c.payload) as any);
            await handleBatchResult(chunk, putResp, 'PUT');
          } catch (putErr: any) {
            await handleBatchError(chunk, putErr, 'PUT');
          }
        } else {
          await handleBatchError(chunk, err, 'POST');
        }
      }
      if (i + POST_CHUNK < newItems.length) await sleep(500);
    }

    // Wait for Trendyol async batch results before finalizing counters / history
    if (pollTasks.length > 0) {
      await Promise.all(pollTasks);
    }

    // Save sync history
    const b = batchStore.get(batchId);
    if (b) {
      await prisma.integrationSyncHistory.create({
        data: {
          type:           'PRODUCT',
          status:         b.failed === b.total ? 'FAILED' : b.failed > 0 ? 'PARTIAL' : 'SUCCESS',
          itemsProcessed: b.success,
          itemsFailed:    b.failed,
          startedAt:      b.startedAt,
          completedAt:    new Date(),
          integration:    { connect: { id: integration.id } },
        },
      }).catch(() => {});
    }

    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { lastSync: new Date() },
    }).catch(() => {});
  }

  // ── INTEGRATION LOGS ────────────────────────────────────────────────────────

  async getIntegrationLogs(
    tenantId: string,
    opts: { status?: string; batchId?: string; page?: string; limit?: string }
  ) {
    const page  = Math.max(1, Number(opts.page)  || 1);
    const limit = Math.min(100, Number(opts.limit) || 50);
    const skip  = (page - 1) * limit;

    const where: any = { tenantId };
    if (opts.status && opts.status !== 'all') where.status = opts.status;
    if (opts.batchId) where.batchId = opts.batchId;

    const [total, logs] = await prisma.$transaction([
      prisma.integrationLog.count({ where }),
      prisma.integrationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, productId: true, productName: true, batchId: true,
          status: true, message: true, createdAt: true,
          requestPayload: true, responsePayload: true,
        },
      }),
    ]);

    return { logs, total, page, totalPages: Math.ceil(total / limit) };
  }

  // ── RETRY FAILED ────────────────────────────────────────────────────────────

  async getFailedProductIds(tenantId: string): Promise<string[]> {
    const maps = await prisma.trendyolProductMap.findMany({
      where:  { tenantId, trendyolStatus: 'ERROR' },
      select: { productId: true },
    });
    return maps.map(m => m.productId);
  }

  /** Query Trendyol's async batch processing result */
  async getTrendyolBatchResult(tenantId: string, trendyolBatchId: string): Promise<any> {
    const integration = await this._getIntegrationOrThrow(tenantId);
    const client      = getClient(integration);
    return client.getBatchRequestStatus(trendyolBatchId);
  }

  /** Get recent Trendyol batch IDs from our integration logs */
  async getRecentTrendyolBatches(tenantId: string): Promise<Array<{ trendyolBatchId: string; productName: string | null; createdAt: Date }>> {
    const rows = await prisma.trendyolProductMap.findMany({
      where:   { tenantId, trendyolStatus: 'SENT', batchId: { not: '' } },
      orderBy: { lastSyncAt: 'desc' },
      take:    50,
      select:  { batchId: true, lastSyncAt: true, product: { select: { name: true } } },
    });
    // batchId stored here is Trendyol's batchRequestId
    return rows.map(r => ({
      trendyolBatchId: r.batchId ?? '',
      productName:     r.product?.name ?? null,
      createdAt:       r.lastSyncAt ?? new Date(),
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _getIntegrationOrThrow(tenantId: string) {
    const integration = await prisma.trendyolIntegration.findFirst({ where: { tenantId } });
    if (!integration) throw new Error('Trendyol entegrasyonu bulunamadı. API bilgilerini kaydedin.');
    return integration;
  }

  /**
   * After sending a product to Trendyol, poll the batch-requests endpoint to
   * get the real async processing result and update IntegrationLog accordingly.
   *
   * Polls a Trendyol batch result for ALL products in a chunk.
   * Matches Trendyol items by barcode → productId.
   */
  private async _pollTrendyolBatchResultForChunk(
    client:          TrendyolClient,
    tenantId:        string,
    chunk:           Array<{ productId: string; productName: string; payload: any }>,
    internalBatchId: string,
    trendyolBatchId: string,
    integrationId?:  string,
  ): Promise<void> {
    const MAX_ATTEMPTS = 16;
    const INTERVAL_MS  = 15_000;

    // Build barcode → {productId, productName} map for matching
    const barcodeMap = new Map<string, { productId: string; productName: string }>(
      chunk.map(c => [String(c.payload.barcode), { productId: c.productId, productName: c.productName }])
    );

    console.log(`[Poll Chunk] START — ${chunk.length} ürün | trendyolBatch: ${trendyolBatchId}`);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await sleep(INTERVAL_MS);

      let batchResult: any;
      try {
        batchResult = await client.getBatchRequestStatus(trendyolBatchId);
      } catch (pollErr: any) {
        console.warn(`[Poll Chunk] attempt ${attempt + 1} network error — ${pollErr?.message}`);
        continue;
      }

      const batchStatus = String(batchResult?.status ?? '').toUpperCase();
      if (batchStatus === 'IN_PROGRESS' || batchStatus === '') continue;

      const items = extractTrendyolBatchItems(batchResult);
      const failedItemCount = Number(batchResult?.failedItemCount ?? 0);

      console.log(`[Poll Chunk] ${batchStatus} — ${items.length} item | failedItemCount: ${failedItemCount}`);

      const { batchStore } = await import('./trendyol.queue');

      const markUnresolvedInChunk = (message: string) => {
        const job = batchStore.get(internalBatchId);
        for (const { productId, productName } of chunk) {
          const row = job?.results.find(r => r.productId === productId);
          if (row && (row.status === 'sending' || row.status === 'pending')) {
            batchStore.updateResult(internalBatchId, productId, {
              status: 'error', productName, message, trendyolBatchId,
            });
            prisma.trendyolProductMap.updateMany({
              where: { tenantId, productId },
              data:  { trendyolStatus: 'ERROR', errorMessage: message, lastSyncAt: new Date() },
            }).catch(() => {});
          }
        }
      };

      if (items.length === 0 && batchStatus === 'COMPLETED') {
        const emptyMsg = failedItemCount > 0
          ? `Trendyol batch tamamlandı ancak ${failedItemCount} ürün hata verdi (detay yok).`
          : 'Trendyol batch tamamlandı ancak ürün sonucu dönmedi. Satıcı panelinden kontrol edin.';
        markUnresolvedInChunk(emptyMsg);
        return;
      }

      // Separate items: success, barcode-conflict (needs PUT), other errors
      const successItems:  any[] = [];
      const barcodeConflictItems: any[] = []; // needs PUT retry
      const failedItems:   any[] = [];

      for (const item of items) {
        const isSuccess  = isTrendyolItemSuccess(item);
        const reasons    = formatTrendyolItemFailure(item);
        const isBarcodeConflict = !isSuccess && reasons.toLowerCase().includes('barkod');

        if (isSuccess)              successItems.push({ item, reasons });
        else if (isBarcodeConflict) barcodeConflictItems.push({ item, reasons });
        else                        failedItems.push({ item, reasons });
      }

      // ── Handle success items ─────────────────────────────────────────────
      for (const { item } of successItems) {
        const barcode     = trendyolItemBarcode(item);
        const matched     = barcodeMap.get(barcode);
        if (!matched) continue;
        const { productId, productName } = matched;

        await prisma.trendyolProductMap.updateMany({
          where: { tenantId, productId },
          data:  { trendyolStatus: 'SENT', errorMessage: null, lastSyncAt: new Date() },
        }).catch(() => {});

        await prisma.integrationLog.create({
          data: { tenantId, productId, productName, batchId: internalBatchId, status: 'success', message: TRENDYOL_API_ACCEPTED_MSG, responsePayload: item },
        }).catch(() => {});

        batchStore.updateResult(internalBatchId, productId, { status: 'success', productName, message: TRENDYOL_API_ACCEPTED_MSG, trendyolBatchId });
      }

      // ── Auto-retry barcode-conflict items with PUT ───────────────────────
      if (barcodeConflictItems.length > 0) {
        const conflictChunk = barcodeConflictItems
          .map(({ item }) => {
            const barcode = String(item.requestItem?.barcode ?? item.barcode ?? '');
            const matched = barcodeMap.get(barcode);
            if (!matched) return null;
            // Find original payload from chunk
            const original = chunk.find(c => String(c.payload.barcode) === barcode);
            return original ? { ...original } : null;
          })
          .filter(Boolean) as Array<{ productId: string; productName: string; payload: any }>;

        console.log(`[Poll Chunk] ${conflictChunk.length} barkod çakışması → PUT ile otomatik güncelleniyor`);

        if (conflictChunk.length > 0) {
          try {
            const putResponse = await client.updateProducts(conflictChunk.map(c => c.payload) as any);
            const putBatchId  = String((putResponse as any)?.batchRequestId ?? (putResponse as any)?.id ?? '');

            for (const { productId, productName } of conflictChunk) {
              await prisma.trendyolProductMap.upsert({
                where:  { tenantId_productId: { tenantId, productId } },
                create: { tenantId, productId, batchId: putBatchId, trendyolStatus: 'SENT', lastSyncAt: new Date(), ...(integrationId ? { integrationId } : {}) },
                update: { batchId: putBatchId, trendyolStatus: 'SENT', errorMessage: null, lastSyncAt: new Date() },
              }).catch(() => {});

              batchStore.updateResult(internalBatchId, productId, {
                status: 'sending', productName, message: 'Barkod çakışması → PUT ile güncelleniyor…', trendyolBatchId: putBatchId,
              });
            }

            if (putBatchId) {
              await this._pollTrendyolBatchResultForChunk(client, tenantId, conflictChunk, internalBatchId, putBatchId, integrationId)
                .catch(e => console.warn('[Poll Chunk] PUT poll failed:', e?.message));
            }
          } catch (putErr: any) {
            const putErrMsg = putErr.response?.data?.errors?.[0]?.message ?? putErr.message ?? 'PUT hatası';
            console.error(`[Poll Chunk] PUT başarısız: ${putErrMsg}`);
            for (const { productId, productName } of conflictChunk) {
              await prisma.trendyolProductMap.updateMany({
                where: { tenantId, productId },
                data:  { trendyolStatus: 'ERROR', errorMessage: `PUT başarısız: ${putErrMsg}`, lastSyncAt: new Date() },
              }).catch(() => {});
              batchStore.updateResult(internalBatchId, productId, { status: 'error', productName, message: `PUT başarısız: ${putErrMsg}` });
            }
          }
        }
      }

      // ── Handle other failed items ────────────────────────────────────────
      for (const { item, reasons } of failedItems) {
        const barcode     = trendyolItemBarcode(item);
        const matched     = barcodeMap.get(barcode);
        if (!matched) { console.warn(`[Poll Chunk] Barcode eşleşmedi: ${barcode}`); continue; }
        const { productId, productName } = matched;

        await prisma.trendyolProductMap.updateMany({
          where: { tenantId, productId },
          data:  { trendyolStatus: 'ERROR', errorMessage: reasons, lastSyncAt: new Date() },
        }).catch(() => {});

        await prisma.integrationLog.create({
          data: { tenantId, productId, productName, batchId: internalBatchId, status: 'error', message: `[Trendyol Batch ${trendyolBatchId}] ${reasons}`, responsePayload: item },
        }).catch(() => {});

        batchStore.updateResult(internalBatchId, productId, {
          status: 'error', productName,
          message: reasons.startsWith('[') ? reasons : `Trendyol reddetti: ${reasons}`,
          trendyolBatchId,
        });
      }

      // Products sent but missing from Trendyol batch response
      const matchedBarcodes = new Set(items.map((i: any) => trendyolItemBarcode(i)).filter(Boolean));
      for (const [barcode, { productId, productName }] of barcodeMap) {
        if (!matchedBarcodes.has(barcode)) {
          const msg = 'Trendyol batch yanıtında bu ürün bulunamadı. Satıcı panelinden kontrol edin.';
          console.warn(`[Poll Chunk] Yanıt gelmedi: ${productName} (barcode: ${barcode})`);
          await prisma.trendyolProductMap.updateMany({
            where: { tenantId, productId },
            data:  { trendyolStatus: 'ERROR', errorMessage: msg, lastSyncAt: new Date() },
          }).catch(() => {});
          batchStore.updateResult(internalBatchId, productId, { status: 'error', productName, message: msg, trendyolBatchId });
        }
      }

      return;
    }

    console.warn(`[Poll Chunk] Zaman aşımı — trendyolBatch: ${trendyolBatchId}`);
    const { batchStore: batchStoreTimeout } = await import('./trendyol.queue');
    const timeoutMsg = 'Trendyol sonucu 4 dakikada alınamadı. Satıcı panelinden batch durumunu kontrol edin.';
    const job = batchStoreTimeout.get(internalBatchId);
    for (const { productId, productName } of chunk) {
      const row = job?.results.find(r => r.productId === productId);
      if (row && (row.status === 'sending' || row.status === 'pending')) {
        batchStoreTimeout.updateResult(internalBatchId, productId, { status: 'error', productName, message: timeoutMsg, trendyolBatchId });
      }
    }
  }

  /**
   * Trendyol typically processes batches within 1–2 minutes.
   * We poll every 15 s for up to 4 minutes, then give up.
   */
  private async _pollTrendyolBatchResult(
    client:          TrendyolClient,
    tenantId:        string,
    productId:       string,
    productName:     string,
    internalBatchId: string,
    trendyolBatchId: string,
  ): Promise<void> {
    const MAX_ATTEMPTS = 16;   // 16 × 15 s = 4 min
    const INTERVAL_MS  = 15_000;
    const { batchStore } = await import('./trendyol.queue');

    console.log(`[Trendyol Poll] START — product: "${productName}" | trendyolBatch: ${trendyolBatchId}`);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await sleep(INTERVAL_MS);

      let batchResult: any;
      try {
        batchResult = await client.getBatchRequestStatus(trendyolBatchId);
        console.log(`[Trendyol Poll] attempt ${attempt + 1} — status: ${batchResult?.status} | product: "${productName}"`);
      } catch (pollErr: any) {
        console.warn(`[Trendyol Poll] attempt ${attempt + 1} network error — ${pollErr?.message}`);
        continue; // network glitch — retry
      }

      // Trendyol returns { status: "IN_PROGRESS" | "COMPLETED" | "FAILED", items: [...] }
      const batchStatus = String(batchResult?.status ?? '').toUpperCase();
      if (batchStatus === 'IN_PROGRESS' || batchStatus === '') continue;

      // Extract per-item result (there should be exactly 1 item since we send 1 at a time)
      const items = extractTrendyolBatchItems(batchResult);
      const item = items[0] ?? {};

      const isSuccess   = items.length > 0 ? isTrendyolItemSuccess(item) : batchStatus === 'COMPLETED';
      const trendyolMsg = isSuccess
        ? TRENDYOL_API_ACCEPTED_MSG
        : (items.length > 0 ? formatTrendyolItemFailure(item) : 'Trendyol batch sonucu alınamadı veya ürün reddedildi.');

      // Update TrendyolProductMap
      await prisma.trendyolProductMap.updateMany({
        where: { tenantId, productId },
        data:  {
          trendyolStatus: isSuccess ? 'SENT' : 'ERROR',
          errorMessage:   isSuccess ? null     : trendyolMsg,
          lastSyncAt:     new Date(),
        },
      }).catch(() => {});

      // Write poll result to IntegrationLog
      console.log(`[Trendyol Poll] RESULT — product: "${productName}" | batchStatus: ${batchStatus} | isSuccess: ${isSuccess} | msg: ${trendyolMsg}`);
      await prisma.integrationLog.create({
        data: {
          tenantId,
          productId,
          productName,
          batchId:         internalBatchId,
          status:          isSuccess ? 'success' : 'error',
          message:         `[Trendyol Batch ${trendyolBatchId}] ${trendyolMsg}`,
          responsePayload: batchResult,
        },
      }).catch(() => {});

      // Also surface in the in-memory batch for the UI progress panel
      if (!isSuccess) {
        batchStore.updateResult(internalBatchId, productId, {
          status:      'error',
          productName,
          message:     `Trendyol reddetti: ${trendyolMsg}`,
          trendyolBatchId,
        });
      } else {
        batchStore.updateResult(internalBatchId, productId, {
          status:      'success',
          productName,
          message:     TRENDYOL_API_ACCEPTED_MSG,
          trendyolBatchId,
        });
      }

      return; // done — no more polling needed
    }

    // Timed out — leave a note in the log
    console.warn(`[Trendyol Poll] TIMEOUT — product: "${productName}" | trendyolBatch: ${trendyolBatchId}`);
    const timeoutMsg = `[Trendyol Batch ${trendyolBatchId}] 4 dakika içinde sonuç alınamadı. Trendyol satıcı panelinden kontrol edin.`;
    await prisma.integrationLog.create({
      data: {
        tenantId, productId, productName,
        batchId: internalBatchId,
        status:  'error',
        message: timeoutMsg,
      },
    }).catch(() => {});
    batchStore.updateResult(internalBatchId, productId, {
      status: 'error', productName, message: timeoutMsg, trendyolBatchId,
    });
  }
}
