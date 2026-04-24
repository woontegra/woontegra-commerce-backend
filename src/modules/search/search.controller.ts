import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { searchService } from './search.service';

// ── GET /api/search/products ──────────────────────────────────────────────────
export async function searchProducts(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;

  const q          = (req.query.q          as string)  || '';
  const categoryId = (req.query.categoryId as string)  || undefined;
  const unitType   = (req.query.unitType   as string)  || undefined;
  const minPrice   = req.query.minPrice  != null ? Number(req.query.minPrice)  : undefined;
  const maxPrice   = req.query.maxPrice  != null ? Number(req.query.maxPrice)  : undefined;
  const isActive   = req.query.isActive  === 'true' ? true
                   : req.query.isActive  === 'false' ? false
                   : undefined;
  const inStock    = req.query.inStock   === 'true';
  const hasVariants = req.query.hasVariants === 'true' ? true
                   : req.query.hasVariants === 'false' ? false
                   : undefined;
  const page       = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit      = Math.min(100, parseInt(req.query.limit as string) || 20);
  const sort       = (req.query.sort as any) || 'newest';

  const result = await searchService.search({
    tenantId, q,
    categoryId, minPrice, maxPrice,
    isActive, inStock, hasVariants, unitType,
    page, limit, sort,
  });

  res.json({ success: true, ...result });
}

// ── GET /api/search/products/facets ───────────────────────────────────────────
export async function getSearchFacets(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const facets   = await searchService.getFacets(tenantId);
  res.json({ success: true, facets });
}

// ── POST /api/search/products/reindex ─────────────────────────────────────────
export async function reindexProducts(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const { ProductService } = await import('../products/product.service');
  const count = await new ProductService().reindexTenant(tenantId);
  res.json({ success: true, message: `${count} ürün yeniden indekslendi.`, count });
}
