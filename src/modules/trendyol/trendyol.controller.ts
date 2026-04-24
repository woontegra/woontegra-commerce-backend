import { Request, Response } from 'express';
import { TrendyolService, TRENDYOL_CARGO_COMPANIES } from './trendyol.service';
import { batchStore } from './trendyol.queue';
import prisma from '../../config/database';
import { orderSyncService } from './trendyol-order-sync.service';
import { syncQueue } from './trendyol-sync-queue.service';

const svc = new TrendyolService();

function tid(req: Request) {
  return req.user?.tenantId as string;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export const getIntegration = async (req: Request, res: Response) => {
  try {
    const data = await svc.getIntegration(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const saveIntegration = async (req: Request, res: Response) => {
  try {
    const { supplierId, apiKey, apiSecret, token, integrationCode } = req.body;
    if (!supplierId?.trim() || !apiKey?.trim() || !apiSecret?.trim()) {
      return res.status(400).json({ error: 'supplierId, apiKey ve apiSecret zorunludur.' });
    }
    const data = await svc.saveIntegration(tid(req), {
      supplierId, apiKey, apiSecret,
      ...(token           ? { token }           : {}),
      ...(integrationCode ? { integrationCode } : {}),
    });
    res.json({ data, message: 'Trendyol API bilgileri kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const testConnection = async (req: Request, res: Response) => {
  try {
    const result = await svc.testConnection(tid(req));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Stats ─────────────────────────────────────────────────────────────────────

export const getStats = async (req: Request, res: Response) => {
  try {
    const data = await svc.getStats(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Categories ────────────────────────────────────────────────────────────────

export const getTrendyolCategories = async (req: Request, res: Response) => {
  try {
    const data = await svc.getTrendyolCategories(tid(req));
    res.json({ data });
  } catch (err: any) {
    const isNotFound = /bulunamadı|not found|entegrasyon/i.test(err.message ?? '');
    res.status(isNotFound ? 404 : 502).json({ error: err.message });
  }
};

export const getTrendyolCategoryAttributes = async (req: Request, res: Response) => {
  try {
    const { categoryId } = req.params;
    const data = await svc.getTrendyolCategoryAttributes(tid(req), categoryId);
    res.json({ data });
  } catch (err: any) {
    const isNotFound = /bulunamadı|not found|entegrasyon/i.test(err.message ?? '');
    res.status(isNotFound ? 404 : 502).json({ error: err.message });
  }
};

export const getLocalCategories = async (req: Request, res: Response) => {
  try {
    const data = await svc.getLocalCategories(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getLocalAttributes = async (req: Request, res: Response) => {
  try {
    const data = await svc.getLocalAttributes(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Mappings ──────────────────────────────────────────────────────────────────

export const getCategoryMapping = async (req: Request, res: Response) => {
  try {
    const data = await svc.getCategoryMapping(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const saveCategoryMapping = async (req: Request, res: Response) => {
  try {
    const { mapping } = req.body;
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'mapping alanı zorunludur.' });
    }
    await svc.saveCategoryMapping(tid(req), mapping);
    res.json({ message: 'Kategori eşleştirmesi kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAttributeMapping = async (req: Request, res: Response) => {
  try {
    const data = await svc.getAttributeMapping(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const saveAttributeMapping = async (req: Request, res: Response) => {
  try {
    const { mapping } = req.body;
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'mapping alanı zorunludur.' });
    }
    await svc.saveAttributeMapping(tid(req), mapping);
    res.json({ message: 'Özellik eşleştirmesi kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Products ──────────────────────────────────────────────────────────────────

export const getProducts = async (req: Request, res: Response) => {
  try {
    const q = req.query as any;
    const data = await svc.getProductsWithTrendyolStatus(tid(req), {
      page:               q.page,
      limit:              q.limit,
      search:             q.search,
      mapped:             q.mapped,
      categoryId:         q.categoryId,
      onlyMappedCategories: q.onlyMappedCategories === 'true' || q.onlyMappedCategories === undefined,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getMappedCategories = async (req: Request, res: Response) => {
  try {
    const cats = await svc.getMappedLocalCategories(tid(req));
    res.json({ categories: cats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getCategoryProductIds = async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    const ids = await svc.getProductIdsByCategory(tid(req), categoryId);
    res.json({ ids, total: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const validateProducts = async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds dizisi zorunludur.' });
    }
    const reports = await svc.validateProducts(tid(req), productIds);
    // Summary stats
    const errors   = reports.filter(r => !r.canSend).length;
    const warnings = reports.filter(r => r.canSend && r.issues.length > 0).length;
    const clean    = productIds.length - reports.length; // products with no issues
    res.json({ data: reports, summary: { total: productIds.length, errors, warnings, clean } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /trendyol/products/send
 *
 * Production-ready send endpoint.
 *
 * Flow:
 *   1. Validate every product (reuses validateProducts service method).
 *   2. Separate valid from invalid.
 *   3. If skipInvalid !== true and there are blocking errors → 400 with details.
 *   4. Enqueue valid products via batchStore + sendProductsBulk.
 *   5. Respond immediately with { batchId, queuedCount, skippedCount }.
 *      Progress is polled via GET /trendyol/batches/:batchId.
 *
 * Body: { productIds: string[], skipInvalid?: boolean }
 */
export const sendProducts = async (req: Request, res: Response) => {
  try {
    const { productIds, skipInvalid = false } = req.body as {
      productIds: string[];
      skipInvalid?: boolean;
    };

    // ── 1. Basic input guard ─────────────────────────────────────────────────
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds dizisi zorunludur.' });
    }

    const tenantId = tid(req);

    // ── 2. Pre-flight validation (reuse service method, no duplicate logic) ──
    // reports always contains one entry per requested product (canSend=true → ok/warn, false → error)
    const reports        = await svc.validateProducts(tenantId, productIds);
    const invalidReports = reports.filter(r => !r.canSend);
    const validReports   = reports.filter(r =>  r.canSend);

    // ── 3. Block if skipInvalid is off and there are hard errors ─────────────
    if (!skipInvalid && invalidReports.length > 0) {
      return res.status(400).json({
        error:           'Bazı ürünlerde gönderim hatası var. Lütfen hataları giderin veya skipInvalid: true ile sadece geçerli ürünleri gönderin.',
        invalidProducts: invalidReports.map(r => ({
          productId: r.productId,
          issues:    r.issues,
        })),
        summary: {
          total:   reports.length,
          valid:   validReports.length,
          invalid: invalidReports.length,
        },
      });
    }

    // ── 4. Decide which IDs to queue ─────────────────────────────────────────
    //   skipInvalid=true  → only canSend=true products are queued
    //   skipInvalid=false → we already blocked above, so all reports are sendable
    const idsToSend = (skipInvalid ? validReports : reports).map(r => r.productId);

    if (idsToSend.length === 0) {
      return res.status(400).json({ error: 'Gönderilecek geçerli ürün bulunamadı. Ürünlerde giderilmemiş hatalar var.' });
    }

    // ── 5. Create batch + enqueue async ─────────────────────────────────────
    const batch = batchStore.create(tenantId, idsToSend);

    // Respond immediately — client polls GET /trendyol/batches/:batchId
    res.json({
      batchId:      batch.batchId,
      queuedCount:  batch.total,
      skippedCount: productIds.length - idsToSend.length,
      status:       'pending',
    });

    // Fire-and-forget; errors surface in batchStore results + IntegrationLog
    svc.sendProductsBulk(tenantId, idsToSend, batch.batchId).catch((err: any) => {
      console.error('[SendProducts] Batch error:', err.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const syncPriceStock = async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body; // optional — if omitted, sync all mapped
    const result = await svc.syncPriceStock(tid(req), productIds);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /trendyol/price-stock-update
 * Manual price/stock update with explicit values.
 * Body: { items: [{ barcode, price, stock, productId? }] }
 */
export const manualPriceStockUpdate = async (req: Request, res: Response) => {
  try {
    const { items } = req.body as { items?: Array<{ barcode: string; price: number; stock: number; productId?: string }> };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items dizisi zorunludur.' });
    }
    // Basic validation
    for (const it of items) {
      if (!it.barcode)              return res.status(400).json({ error: `barcode zorunludur.` });
      if (typeof it.price !== 'number' || it.price < 0) return res.status(400).json({ error: `Geçersiz fiyat: ${it.barcode}` });
      if (typeof it.stock !== 'number' || it.stock < 0) return res.status(400).json({ error: `Geçersiz stok: ${it.barcode}` });
    }
    const result = await svc.manualPriceStockUpdate(tid(req), items);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /trendyol/products/mapped-with-variants */
export const getMappedProductsWithVariants = async (req: Request, res: Response) => {
  try {
    const data = await svc.getMappedProductsWithVariants(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const removeProductMap = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    await svc.removeProductMap(tid(req), productId);
    res.json({ message: 'Ürün Trendyol eşleştirmesinden kaldırıldı.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Sync History ──────────────────────────────────────────────────────────────

export const getSyncHistory = async (req: Request, res: Response) => {
  try {
    const data = await svc.getSyncHistory(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Bulk Send (queue-based, async) ────────────────────────────────────────────

/**
 * POST /trendyol/products/bulk-send
 *
 * Queue-based bulk send.  The frontend validation modal already filters IDs
 * before calling this endpoint, so skipInvalid defaults to true (backward
 * compatible).  Callers that want server-side filtering can pass
 * skipInvalid: false to block on any product with hard errors.
 *
 * Body: { productIds: string[], skipInvalid?: boolean }
 */
export const bulkSendProducts = async (req: Request, res: Response) => {
  try {
    const { productIds, skipInvalid = true } = req.body as {
      productIds: string[];
      skipInvalid?: boolean;
    };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds dizisi zorunludur.' });
    }

    const tenantId = tid(req);

    // Optional server-side validation gate
    let idsToSend: string[] = productIds;
    let skippedCount        = 0;

    if (!skipInvalid) {
      const reports        = await svc.validateProducts(tenantId, productIds);
      const invalidReports = reports.filter(r => !r.canSend);

      if (invalidReports.length > 0) {
        return res.status(400).json({
          error:           'Bazı ürünlerde gönderim hatası var.',
          invalidProducts: invalidReports.map(r => ({ productId: r.productId, issues: r.issues })),
          summary: {
            total:   reports.length,
            valid:   reports.length - invalidReports.length,
            invalid: invalidReports.length,
          },
        });
      }

      idsToSend    = reports.filter(r => r.canSend).map(r => r.productId);
      skippedCount = productIds.length - idsToSend.length;
    }

    if (idsToSend.length === 0) {
      return res.status(400).json({ error: 'Gönderilecek geçerli ürün bulunamadı.' });
    }

    const batch = batchStore.create(tenantId, idsToSend);

    // Respond immediately — UI polls GET /trendyol/batches/:batchId
    res.json({
      batchId:      batch.batchId,
      total:        batch.total,
      queuedCount:  batch.total,
      skippedCount,
      status:       'pending',
    });

    // Fire-and-forget; errors surface in batchStore results + IntegrationLog
    svc.sendProductsBulk(tenantId, idsToSend, batch.batchId).catch((err: any) => {
      console.error('[BulkSend] Error:', err.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /trendyol/batches/:batchId
 * Poll batch progress.
 */
export const getBatchStatus = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const batch = batchStore.get(batchId);
    if (!batch || batch.tenantId !== tid(req)) {
      return res.status(404).json({ error: 'Batch bulunamadı.' });
    }
    res.json(batch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /trendyol/products/retry-failed
 * Retry all products with status=ERROR. Returns a new batchId.
 */
export const retryFailed = async (req: Request, res: Response) => {
  try {
    const tenantId  = tid(req);
    const failedIds = await svc.getFailedProductIds(tenantId);
    if (failedIds.length === 0) {
      return res.json({ message: 'Hatalı ürün yok.', batchId: null, total: 0 });
    }
    const batch = batchStore.create(tenantId, failedIds);
    res.json({ batchId: batch.batchId, total: batch.total, status: 'pending' });
    svc.sendProductsBulk(tenantId, failedIds, batch.batchId).catch((err: any) => {
      console.error('[RetryFailed] Error:', err.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /trendyol/products/reset-trendyol
 * Deletes TrendyolProductMap records for given productIds so they can be re-sent as new products.
 * Body: { productIds?: string[], resetAll?: boolean }
 */
export const resetTrendyolRecords = async (req: Request, res: Response) => {
  try {
    const tenantId  = tid(req);
    const { productIds, resetAll } = req.body as { productIds?: string[]; resetAll?: boolean };

    if (resetAll) {
      const result = await prisma.trendyolProductMap.deleteMany({ where: { tenantId } });
      return res.json({ deleted: result.count, message: `${result.count} Trendyol kaydı sıfırlandı.` });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds dizisi veya resetAll:true zorunludur.' });
    }

    const result = await prisma.trendyolProductMap.deleteMany({
      where: { tenantId, productId: { in: productIds } },
    });

    return res.json({ deleted: result.count, message: `${result.count} Trendyol kaydı sıfırlandı. Bir sonraki gönderimde yeni ürün olarak iletilecek.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /trendyol/logs
 * Integration logs with filtering.
 */
export const getIntegrationLogs = async (req: Request, res: Response) => {
  try {
    const data = await svc.getIntegrationLogs(tid(req), req.query as any);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Trendyol Batch Status ─────────────────────────────────────────────────────

/** GET /trendyol/trendyol-batch/:batchRequestId — query Trendyol async batch result */
export const getTrendyolBatchResult = async (req: Request, res: Response) => {
  try {
    const { batchRequestId } = req.params;
    const data = await svc.getTrendyolBatchResult(tid(req), batchRequestId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /trendyol/trendyol-batches/recent — list recent Trendyol batchRequestIds we sent */
export const getRecentTrendyolBatches = async (req: Request, res: Response) => {
  try {
    const data = await svc.getRecentTrendyolBatches(tid(req));
    res.json({ batches: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Brand Mapping ─────────────────────────────────────────────────────────────

/** GET /trendyol/trendyol-brands?name=query — search Trendyol brands */
export const getTrendyolBrands = async (req: Request, res: Response) => {
  try {
    const search = req.query.name as string | undefined;
    const data   = await svc.getTrendyolBrands(tid(req), search);
    res.json({ data });
  } catch (err: any) {
    const isAuth = /bulunamadı|entegrasyon|not found/i.test(err.message ?? '');
    res.status(isAuth ? 404 : 502).json({ error: err.message });
  }
};

/** POST /trendyol/trendyol-brands — create brand on Trendyol */
export const createTrendyolBrand = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Marka adı zorunludur.' });
    const data = await svc.createTrendyolBrand(tid(req), name.trim());
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /trendyol/brand-mapping — saved brand mapping */
export const getBrandMapping = async (req: Request, res: Response) => {
  try {
    const data = await svc.getBrandMapping(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /trendyol/brand-mapping — save brand mapping */
export const saveBrandMapping = async (req: Request, res: Response) => {
  try {
    const { mapping } = req.body;
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'mapping alanı zorunludur.' });
    }
    await svc.saveBrandMapping(tid(req), mapping);
    res.json({ message: 'Marka eşleştirmesi kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /trendyol/local-brands — unique brand strings from tenant products */
export const getLocalBrands = async (req: Request, res: Response) => {
  try {
    const data = await svc.getLocalBrands(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Shipping Defaults ─────────────────────────────────────────────────────────

/** GET /trendyol/shipping-defaults */
export const getShippingDefaults = async (req: Request, res: Response) => {
  try {
    const data = await svc.getShippingDefaults(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /trendyol/shipping-defaults */
export const saveShippingDefaults = async (req: Request, res: Response) => {
  try {
    const { cargoCompanyId, deliveryDuration, dimensionalWeight } = req.body;
    await svc.saveShippingDefaults(tid(req), {
      ...(cargoCompanyId   != null ? { cargoCompanyId:   Number(cargoCompanyId)   } : {}),
      ...(deliveryDuration != null ? { deliveryDuration: Number(deliveryDuration) } : {}),
      ...(dimensionalWeight!= null ? { dimensionalWeight:Number(dimensionalWeight)} : {}),
    });
    res.json({ message: 'Kargo ayarları kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /trendyol/cargo-companies — static list of Trendyol cargo companies */
export const getCargoCompanies = (_req: Request, res: Response) => {
  res.json({ data: TRENDYOL_CARGO_COMPANIES });
};

// ── Price Strategy ────────────────────────────────────────────────────────────

/** GET /trendyol/price-strategy */
export const getPriceStrategy = async (req: Request, res: Response) => {
  try {
    const data = await svc.getPriceStrategy(tid(req));
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /trendyol/price-strategy */
export const savePriceStrategy = async (req: Request, res: Response) => {
  try {
    const { mode, value, vatRate, vatIncluded, roundTo } = req.body;
    const data = await svc.savePriceStrategy(tid(req), {
      ...(mode        !== undefined ? { mode }        : {}),
      ...(value       !== undefined ? { value:       Number(value) }       : {}),
      ...(vatRate     !== undefined ? { vatRate:     Number(vatRate) }     : {}),
      ...(vatIncluded !== undefined ? { vatIncluded: Boolean(vatIncluded) } : {}),
      ...(roundTo     !== undefined ? { roundTo:     Number(roundTo) }     : {}),
    });
    res.json({ data, message: 'Fiyat stratejisi kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Per-product price override ────────────────────────────────────────────────

/** GET /trendyol/price-override/:productId */
export const getProductPriceOverride = async (req: Request, res: Response) => {
  try {
    const data = await svc.getProductPriceOverride(tid(req), req.params.productId);
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /trendyol/price-override/:productId */
export const saveProductPriceOverride = async (req: Request, res: Response) => {
  try {
    const { customPrice, mode, value, vatRate } = req.body;
    const data = await svc.saveProductPriceOverride(tid(req), req.params.productId, {
      customPrice: customPrice != null ? Number(customPrice) : undefined,
      mode:        mode ?? undefined,
      value:       value != null ? Number(value) : undefined,
      vatRate:     vatRate != null ? Number(vatRate) : undefined,
    });
    res.json({ data, message: 'Ürün fiyat ayarı kaydedildi.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** DELETE /trendyol/price-override/:productId */
export const deleteProductPriceOverride = async (req: Request, res: Response) => {
  try {
    await svc.deleteProductPriceOverride(tid(req), req.params.productId);
    res.json({ message: 'Ürün fiyat ayarı kaldırıldı.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Ürün Bazlı Trendyol Ayarları ─────────────────────────────────────────────

/**
 * GET /api/trendyol/product-settings/:productId
 * Bir ürünün Trendyol override ayarlarını döner (yoksa null).
 */
export const getProductSettings = async (req: Request, res: Response) => {
  try {
    const tenantId  = tid(req);
    const productId = req.params.productId;

    const settings = await prisma.trendyolProductSettings.findFirst({
      where: { tenantId, productId },
    });

    // Toplu entegrasyon ayarlarını da dön (kategori/marka listesi için)
    const integration = await prisma.trendyolIntegration.findFirst({
      where:  { tenantId, isActive: true },
      select: { categoryMappings: true, brandMappings: true, attributeMappings: true, shippingDefaults: true },
    });

    res.json({ success: true, data: { settings, integration } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/trendyol/product-settings
 * Ürün bazlı Trendyol ayarlarını oluşturur veya günceller.
 */
export const saveProductSettings = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const {
      productId,
      trendyolCategoryId,
      trendyolBrandId,
      attributes,
      priceType,
      priceValue,
      cargoCompanyId,
      deliveryDuration,
      vatRate,
      isOverride,
    } = req.body;

    if (!productId) return res.status(400).json({ success: false, error: 'productId zorunludur.' });

    // Ürün tenant'a ait mi kontrol et
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
    if (!product) return res.status(404).json({ success: false, error: 'Ürün bulunamadı.' });

    const data: any = {
      tenantId,
      productId,
      isOverride: isOverride !== false,
    };
    if (trendyolCategoryId !== undefined) data.trendyolCategoryId = trendyolCategoryId ? String(trendyolCategoryId) : null;
    if (trendyolBrandId    !== undefined) data.trendyolBrandId    = trendyolBrandId    ? Number(trendyolBrandId)    : null;
    if (attributes         !== undefined) data.attributes         = attributes ?? {};
    if (priceType          !== undefined) data.priceType          = priceType  ?? 'none';
    if (priceValue         !== undefined) data.priceValue         = Number(priceValue ?? 0);
    if (cargoCompanyId     !== undefined) data.cargoCompanyId     = cargoCompanyId ? Number(cargoCompanyId) : null;
    if (deliveryDuration   !== undefined) data.deliveryDuration   = deliveryDuration ? Number(deliveryDuration) : null;
    if (vatRate            !== undefined) data.vatRate            = Number(vatRate ?? 18);

    const settings = await prisma.trendyolProductSettings.upsert({
      where:  { productId },
      create: data,
      update: data,
    });

    res.json({ success: true, data: settings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/trendyol/product-settings/:productId
 * Ürünün override ayarlarını siler (toplu ayarlara geri döner).
 */
export const deleteProductSettings = async (req: Request, res: Response) => {
  try {
    const tenantId  = tid(req);
    const productId = req.params.productId;

    await prisma.trendyolProductSettings.deleteMany({ where: { tenantId, productId } });
    res.json({ success: true, message: 'Ayarlar silindi, toplu entegrasyon ayarları geçerli olacak.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Trendyol Fiyat/Stok Sync Queue ───────────────────────────────────────────

/**
 * POST /api/trendyol/sync-queue/process
 * Bekleyen fiyat/stok kayıtlarını manuel olarak Trendyol'a gönderir.
 */
export const processSyncQueueManual = async (req: Request, res: Response) => {
  try {
    const result = await syncQueue.processSyncQueue();
    res.json({
      success: true,
      message: `${result.processed} kayıt işlendi — ${result.success} başarılı, ${result.failed} hatalı.`,
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/trendyol/sync-queue/stats
 * Kuyruk durum özeti.
 */
export const getSyncQueueStats = async (req: Request, res: Response) => {
  try {
    const stats = await syncQueue.getStats(tid(req));
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/trendyol/sync-queue/retry
 * Başarısız kayıtları yeniden kuyruğa alır.
 */
export const retrySyncQueue = async (req: Request, res: Response) => {
  try {
    const count = await syncQueue.retryFailed(tid(req));
    res.json({ success: true, message: `${count} kayıt yeniden kuyruğa alındı.`, data: { count } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Trendyol Order Sync ───────────────────────────────────────────────────────

/**
 * POST /api/trendyol/orders/sync
 * Trendyol'dan siparişleri manuel olarak çeker ve sisteme kaydeder.
 */
export const syncTrendyolOrders = async (req: Request, res: Response) => {
  try {
    const result = await orderSyncService.syncForTenant(tid(req));
    res.json({
      success: true,
      message: `${result.synced} yeni sipariş kaydedildi, ${result.skipped} atlandı${result.errors > 0 ? `, ${result.errors} hata` : ''}.`,
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/trendyol/orders
 * Sistemdeki Trendyol siparişlerini listeler (sayfalandırmalı).
 */
export const getTrendyolOrders = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const page     = Math.max(0, Number(req.query.page  ?? 0));
    const limit    = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const status   = req.query.status as string | undefined;

    const where: any = { tenantId };
    if (status) where.status = status;

    const [total, orders] = await Promise.all([
      prisma.trendyolOrder.count({ where }),
      prisma.trendyolOrder.findMany({
        where,
        include: { items: true },
        orderBy: { orderDate: 'desc' },
        skip:    page * limit,
        take:    limit,
      }),
    ]);

    res.json({
      success: true,
      data: { orders, total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/trendyol/orders/:orderNumber
 * Belirli bir Trendyol siparişinin detayını döner.
 */
export const getTrendyolOrderDetail = async (req: Request, res: Response) => {
  try {
    const tenantId    = tid(req);
    const orderNumber = req.params.orderNumber;

    const order = await prisma.trendyolOrder.findUnique({
      where:   { tenantId_orderNumber: { tenantId, orderNumber } },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
    }
    res.json({ success: true, data: order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};
