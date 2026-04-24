/**
 * MarketplaceHub Controller
 * POST/GET /api/marketplace-hub/:slug/*
 *
 * Provider-agnostic API: aynı endpoint → farklı pazaryerleri.
 * Mevcut /api/trendyol/* route'ları dokunulmaz, bu yeni/ek endpoint'tir.
 */

import { Request, Response } from 'express';
import { orchestrator } from './MarketplaceOrchestrator';
import { isKnownMarketplace, KNOWN_MARKETPLACE_SLUGS } from '../../factory/MarketplaceFactory';
import { logger } from '../../../../config/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantId(req: Request): string {
  return (req as any).user?.tenantId ?? (req as any).tid ?? '';
}

function getSlug(req: Request): string {
  return (req.params.slug ?? '').toLowerCase();
}

function validateSlug(slug: string, res: Response): boolean {
  if (!isKnownMarketplace(slug)) {
    res.status(404).json({
      success: false,
      error:   `Bilinmeyen pazaryeri: "${slug}"`,
      available: KNOWN_MARKETPLACE_SLUGS,
    });
    return false;
  }
  return true;
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/marketplace-hub/
 * Tüm pazaryerleri listesi (slug + aktif mi)
 */
export async function listMarketplaces(req: Request, res: Response) {
  return res.json({
    success: true,
    data:    KNOWN_MARKETPLACE_SLUGS.map(slug => ({ slug, available: true })),
  });
}

/**
 * GET /api/marketplace-hub/:slug/status
 * Pazaryeri bağlantı durumu + temel bilgi
 */
export async function getMarketplaceStatus(req: Request, res: Response) {
  const slug     = getSlug(req);
  const tenantId = getTenantId(req);
  if (!validateSlug(slug, res)) return;

  try {
    const result = await orchestrator.testConnection(tenantId, slug);
    return res.json({ success: true, data: { slug, ...result } });
  } catch (err: any) {
    logger.error({ message: '[HubCtrl] getMarketplaceStatus hata', slug, tenantId, err: err.message });
    return res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace-hub/:slug/test-connection
 * Bağlantıyı test et
 */
export async function testConnection(req: Request, res: Response) {
  const slug     = getSlug(req);
  const tenantId = getTenantId(req);
  if (!validateSlug(slug, res)) return;

  try {
    const result = await orchestrator.testConnection(tenantId, slug);
    return res.json({ success: result.ok, data: result });
  } catch (err: any) {
    logger.error({ message: '[HubCtrl] testConnection hata', slug, tenantId, err: err.message });
    return res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace-hub/:slug/send-products
 * Body: { products: NormalizedProduct[] }
 */
export async function sendProducts(req: Request, res: Response) {
  const slug     = getSlug(req);
  const tenantId = getTenantId(req);
  if (!validateSlug(slug, res)) return;

  const products = req.body?.products;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: 'products dizisi boş veya eksik.' });
  }

  try {
    const result = await orchestrator.sendProducts(tenantId, slug, products);
    return res.json({ success: result.success, data: result });
  } catch (err: any) {
    logger.error({ message: '[HubCtrl] sendProducts hata', slug, tenantId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/marketplace-hub/:slug/update-stock-price
 * Body: { items: StockPriceItem[] }
 */
export async function updateStockAndPrice(req: Request, res: Response) {
  const slug     = getSlug(req);
  const tenantId = getTenantId(req);
  if (!validateSlug(slug, res)) return;

  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items dizisi boş veya eksik.' });
  }

  try {
    const result = await orchestrator.updateStockAndPrice(tenantId, slug, items);
    return res.json({ success: result.success, data: result });
  } catch (err: any) {
    logger.error({ message: '[HubCtrl] updateStockAndPrice hata', slug, tenantId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/marketplace-hub/:slug/orders
 * Query: startDate, endDate, status, page, size
 */
export async function fetchOrders(req: Request, res: Response) {
  const slug     = getSlug(req);
  const tenantId = getTenantId(req);
  if (!validateSlug(slug, res)) return;

  const { startDate, endDate, status, page, size } = req.query as Record<string, string>;

  try {
    const orders = await orchestrator.fetchOrders(tenantId, slug, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate:   endDate   ? new Date(endDate)   : undefined,
      status,
      page:  page ? Number(page)  : 0,
      size:  size ? Number(size)  : 50,
    });

    return res.json({ success: true, data: { orders, total: orders.length } });
  } catch (err: any) {
    logger.error({ message: '[HubCtrl] fetchOrders hata', slug, tenantId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
}
