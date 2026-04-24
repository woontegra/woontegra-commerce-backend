import path   from 'path';
import fs     from 'fs';
import multer from 'multer';
import { Request, Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { ProductService, buildVariantDisplayName } from './product.service';
import { invalidateCache } from '../../common/middleware/cache.middleware';
import prisma from '../../config/database';
import { ensureBarcode, canOverrideBarcode } from './barcode.service';
import { syncQueue } from '../trendyol/trendyol-sync-queue.service';

// ─── Image upload (disk storage) ─────────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const productStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req: any, file, cb) => {
    const tenantId = req.user?.tenantId ?? 'unknown';
    const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${tenantId}_${Date.now()}${ext}`);
  },
});

export const productImageUploader = multer({
  storage:    productStorage,
  limits:     { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Sadece resim dosyaları kabul edilir.'));
  },
}).single('image');

const BASE_URL = () =>
  process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

// ─── Controller ───────────────────────────────────────────────────────────────

export class ProductController {
  private svc = new ProductService();

  // ── GET /api/products ──────────────────────────────────────────────────────

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId; // always scoped to tenant
      const q        = req.query as Record<string, string | undefined>;

      // Parse & sanitize query params
      const page     = Math.max(1, parseInt(q.page  ?? '1',  10) || 1);
      const limit    = Math.min(100, parseInt(q.limit ?? '20', 10) || 20);
      const minPrice = q.minPrice ? parseFloat(q.minPrice) : undefined;
      const maxPrice = q.maxPrice ? parseFloat(q.maxPrice) : undefined;
      const isActive = q.isActive !== undefined
        ? q.isActive === 'true'
        : undefined;

      const result = await this.svc.getAll(tenantId, {
        search:     q.search?.trim()     || undefined,
        categoryId: q.categoryId?.trim() || undefined,
        status:     q.status?.trim()     || undefined,
        isActive,
        minPrice:   Number.isFinite(minPrice) ? minPrice : undefined,
        maxPrice:   Number.isFinite(maxPrice) ? maxPrice : undefined,
        page,
        limit,
        sortBy:     q.sortBy  || undefined,
        sortDir:    q.sortDir === 'asc' ? 'asc' : 'desc',
      });

      res.json({
        status: 'success',
        data:   result,   // { items, total, page, limit, totalPages }
      });
    } catch (err: any) {
      console.error('[Product.getAll]', err?.message);
      res.status(500).json({ error: err?.message ?? 'Failed to fetch products' });
    }
  };

  // ── PATCH /api/products/:id/quick — inline price/stock/status update ────────

  quickUpdate = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id }      = req.params;
      const tenantId    = req.user!.tenantId;
      const { price, stock, isActive, status } = req.body;

      // Verify ownership
      const existing = await prisma.product.findFirst({ where: { id, tenantId } });
      if (!existing) { res.status(404).json({ error: 'Product not found' }); return; }

      const updates: any = {};
      if (price    !== undefined) updates.price    = Number(price);
      if (isActive !== undefined) {
        updates.isActive = Boolean(isActive);
        // Keep status in sync: activating → 'active', deactivating → 'draft'
        // (only override if status is not explicitly provided and product is in draft/active)
        if (status === undefined) {
          if (Boolean(isActive) && existing.status === 'draft') updates.status = 'active';
          if (!Boolean(isActive) && existing.status === 'active') updates.status = 'draft';
        }
      }
      if (status   !== undefined) updates.status   = status;

      const product = await prisma.product.update({ where: { id }, data: updates });

      // Update stock quantity if provided
      if (stock !== undefined) {
        await this.svc.upsertStock(id, tenantId, { quantity: Number(stock) });
      }

      // Update pricing.salePrice if price changed
      if (price !== undefined) {
        await prisma.productPrice.upsert({
          where:  { productId: id },
          create: { productId: id, salePrice: Number(price), vatRate: 18, currency: 'TRY' },
          update: { salePrice: Number(price) },
        });
      }

      // Trendyol sync queue — fiyat veya stok değiştiyse kuyruğa ekle
      if ((price !== undefined || stock !== undefined) && product.barcode) {
        const currentStock = await prisma.stock.findUnique({ where: { productId: id }, select: { quantity: true } });
        const qtyVal  = stock  !== undefined ? Number(stock)  : Number(currentStock?.quantity ?? 0);
        const priceVal = price !== undefined ? Number(price) : Number(product.price);
        syncQueue.enqueue({
          tenantId:  tenantId!,
          barcode:   product.barcode,
          listPrice: priceVal,
          salePrice: priceVal,
          quantity:  Math.max(0, Math.round(qtyVal)),
        }).catch(() => {}); // fire & forget — UI yanıtını bekletme
      }

      await invalidateCache(`products:${tenantId}:*`);
      res.json({ status: 'success', data: product });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Quick update failed' });
    }
  };

  // ── GET /api/products/:id ──────────────────────────────────────────────────

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const product = await this.svc.getById(req.params.id, req.user!.tenantId);
      if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
      res.json({ status: 'success', data: product });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to fetch product' });
    }
  };

  // ── GET /api/products/slug/:slug ───────────────────────────────────────────

  getBySlug = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const product = await this.svc.getBySlug(req.params.slug, req.user!.tenantId);
      if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
      res.json({ status: 'success', data: product });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to fetch product' });
    }
  };

  // ── POST /api/products ─────────────────────────────────────────────────────

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    const t0 = Date.now();
    try {
      const tenantId = req.user!.tenantId;
      const { stock, pricing, shipping, ...rest } = req.body;
      const payload: any = { ...rest };

      const t1 = Date.now();
      const product = await this.svc.create({ ...payload, pricing, shipping }, tenantId);
      const t2 = Date.now();

      // Upsert stock
      if (stock !== undefined) {
        await this.svc.upsertStock(product.id, tenantId, {
          quantity: Number(stock.quantity ?? stock ?? 0),
          unit:     stock.unit ?? 'adet',
          minStock: stock.minStock ?? null,
        });
      }
      const t3 = Date.now();

      // Fire-and-forget cache invalidation (don't await — prevents Redis hang blocking response)
      invalidateCache(`products:${tenantId}:*`).catch(() => {});
      
      console.info(`[Product.create] total=${Date.now()-t0}ms create=${t2-t1}ms stock=${t3-t2}ms`);
      res.status(201).json({ status: 'success', data: product });
    } catch (err: any) {
      console.error('[Product.create] ERROR:', {
        message:  err?.message,
        code:     err?.code,
        meta:     err?.meta,
        stack:    err?.stack?.split('\n').slice(0, 5).join('\n'),
      });
      res.status(500).json({
        error:   err?.message ?? 'Failed to create product',
        code:    err?.code,
        details: process.env.NODE_ENV !== 'production' ? err?.meta : undefined,
      });
    }
  };

  // ── PUT /api/products/:id ──────────────────────────────────────────────────

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId  = req.user!.tenantId;
      const productId = req.params.id;
      const { stock, pricing, shipping, ...rest } = req.body;

      const product = await this.svc.update(productId, { ...rest, pricing, shipping }, tenantId);

      if (stock !== undefined) {
        await this.svc.upsertStock(productId, tenantId, {
          quantity: Number(stock.quantity ?? stock ?? 0),
          unit:     stock.unit ?? 'adet',
          minStock: stock.minStock ?? null,
        });
      }

      invalidateCache(`product:${tenantId}:*${productId}*`).catch(() => {});
      invalidateCache(`products:${tenantId}:*`).catch(() => {});

      res.json({ status: 'success', data: product });
    } catch (err: any) {
      console.error('[Product.update] ERROR:', {
        message: err?.message,
        code:    err?.code,
        meta:    err?.meta,
      });
      res.status(500).json({
        error:   err?.message ?? 'Failed to update product',
        code:    err?.code,
        details: process.env.NODE_ENV !== 'production' ? err?.meta : undefined,
      });
    }
  };

  // ── PATCH /api/products/:id  (partial update) ─────────────────────────────

  patch = async (req: AuthRequest, res: Response): Promise<void> => {
    return this.update(req, res);
  };

  // ── DELETE /api/products/:id ───────────────────────────────────────────────

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      await this.svc.delete(req.params.id, tenantId);
      await invalidateCache(`product:${tenantId}:*${req.params.id}*`);
      await invalidateCache(`products:${tenantId}:*`);
      res.status(204).send();
    } catch (err: any) {
      res.status(400).json({ error: err?.message });
    }
  };

  // ── PUT /api/products/:id/pricing ─────────────────────────────────────────

  savePricing = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await this.svc.upsertPricing(
        req.params.id,
        req.user!.tenantId,
        req.body,
      );
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to save pricing' });
    }
  };

  // ── PUT /api/products/:id/shipping ────────────────────────────────────────

  saveShipping = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await this.svc.upsertShipping(
        req.params.id,
        req.user!.tenantId,
        req.body,
      );
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to save shipping' });
    }
  };

  // ── PUT /api/products/:id/images ──────────────────────────────────────────

  saveImages = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const images = req.body.images ?? [];
      const result = await this.svc.saveImages(
        req.params.id,
        req.user!.tenantId,
        images,
      );
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to save images' });
    }
  };

  // ── PUT /api/products/:id/stock ───────────────────────────────────────────

  saveStock = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await this.svc.upsertStock(
        req.params.id,
        req.user!.tenantId,
        req.body,
      );
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to save stock' });
    }
  };

  // ── GET /api/products/:id/variants ────────────────────────────────────────

  getVariants = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const product = await prisma.product.findFirst({
        where:   { id: req.params.id, tenantId: req.user!.tenantId },
        include: { variants: true },
      });
      if (!product) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ status: 'success', data: product.variants });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed' });
    }
  };

  // ── PUT /api/products/:id/variants  (production-level relational upsert) ──
  //
  // Each variant in the payload may carry:
  //   attributeValues: [{ attributeId, valueId?, textValue? }]  ← relational
  //   combination: { "Renk": "Kırmızı" }                       ← legacy display cache
  //
  // Matching strategy:
  //   1. If attributeValues present → use sorted "attrId:valueId" key
  //   2. Otherwise fall back to JSON.stringify(combination)
  //
  // Merge behaviour: existing variants that match keep price/stock/sku/isActive;
  //   only explicitly provided fields are updated.

  saveVariants = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { options, variants } = req.body;
      const productId = req.params.id;
      const tenantId  = req.user!.tenantId;

      const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
      if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

      // Update product-level flags
      await prisma.product.update({
        where: { id: productId },
        data:  { variantOptions: options ?? null, hasVariants: (options?.length ?? 0) > 0 },
      });

      if (!Array.isArray(variants) || variants.length === 0) {
        await prisma.productVariant.deleteMany({ where: { productId } });
        res.json({ status: 'success', data: [] });
        return;
      }

      // ── Build a stable combination key ─────────────────────────────────────
      const buildKey = (v: any): string => {
        if (Array.isArray(v.attributeValues) && v.attributeValues.length > 0) {
          return [...v.attributeValues]
            .sort((a: any, b: any) => (a.attributeId as string).localeCompare(b.attributeId))
            .map((av: any) => `${av.attributeId}:${av.valueId ?? av.textValue ?? ''}`)
            .join('|');
        }
        // Fallback: sort by key so {"A":"x","B":"y"} === {"B":"y","A":"x"}
        const combo = v.combination ?? {};
        return Object.keys(combo).sort().map(k => `${k}:${combo[k]}`).join('|');
      };

      // ── Load existing variants with their VariantAttribute records ──────────
      const existingVariants = await prisma.productVariant.findMany({
        where:   { productId },
        include: { variantAttributes: true },
      });

      // Build map: key → existing variant
      const existingMap = new Map<string, typeof existingVariants[0]>();
      for (const ev of existingVariants) {
        let key: string;
        if (ev.variantAttributes.length > 0) {
          key = [...ev.variantAttributes]
            .sort((a, b) => a.attributeId.localeCompare(b.attributeId))
            .map(va => `${va.attributeId}:${va.valueId ?? va.textValue ?? ''}`)
            .join('|');
        } else {
          const combo = ev.combination as Record<string, string> ?? {};
          key = Object.keys(combo).sort().map(k => `${k}:${combo[k]}`).join('|');
        }
        existingMap.set(key, ev);
      }

      const incomingKeys = new Set(variants.map(buildKey));

      // Delete variants that are no longer in the incoming list
      for (const [key, ev] of existingMap) {
        if (!incomingKeys.has(key)) {
          await prisma.productVariant.delete({ where: { id: ev.id } });
        }
      }

      // Upsert each incoming variant
      for (const v of variants) {
        const key      = buildKey(v);
        const existing = existingMap.get(key);

        const priceVal = (v.price !== undefined && v.price !== '' && v.price !== null)
          ? Number(v.price) : null;
        const discountPriceVal = (v.discountPrice !== undefined && v.discountPrice !== '' && v.discountPrice !== null)
          ? Number(v.discountPrice) : null;
        const skuVal  = v.sku?.trim() || null;
        const comboJson = v.combination ?? {};
        const displayName = v.name
          ?? (Array.isArray(v.attributeValues) && v.attributeValues.length > 0
            ? v.attributeValues.map((av: any) => av.label ?? av.textValue ?? av.valueId ?? '').join(' / ')
            : Object.values(comboJson).join(' / '))
          || 'Varyant';

        let variantId: string;

        if (existing) {
          await prisma.productVariant.update({
            where: { id: existing.id },
            data: {
              name:          displayName,
              combination:   comboJson,
              price:         priceVal !== null ? priceVal : existing.price,
              discountPrice: discountPriceVal !== null ? discountPriceVal : existing.discountPrice,
              sku:           skuVal   !== null ? skuVal   : existing.sku,
              barcode:       v.barcode  !== undefined ? (v.barcode?.trim()  || null) : existing.barcode,
              stockQuantity: v.stock    !== undefined ? Number(v.stock)               : existing.stockQuantity,
              isActive:      v.isActive !== undefined ? Boolean(v.isActive)           : existing.isActive,
            },
          });
          variantId = existing.id;
        } else {
          const safeSku = skuVal || `${productId.slice(-6)}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          const created = await prisma.productVariant.create({
            data: {
              productId,
              name:          displayName,
              combination:   comboJson,
              price:         priceVal,
              discountPrice: discountPriceVal,
              sku:           safeSku,
              barcode:       v.barcode?.trim() || null,
              stockQuantity: Number(v.stock ?? 0),
              isActive:      v.isActive !== undefined ? Boolean(v.isActive) : true,
            },
          });
          variantId = created.id;
        }

        // ── Upsert VariantAttribute records (relational mapping) ─────────────
        if (Array.isArray(v.attributeValues) && v.attributeValues.length > 0) {
          const incomingAttrIds = new Set<string>();

          for (const av of v.attributeValues as Array<{ attributeId: string; valueId?: string | null; textValue?: string | null; label?: string }>) {
            incomingAttrIds.add(av.attributeId);
            await prisma.variantAttribute.upsert({
              where:  { variantId_attributeId: { variantId, attributeId: av.attributeId } },
              create: {
                variantId,
                attributeId: av.attributeId,
                valueId:     av.valueId   ?? null,
                textValue:   av.textValue ?? null,
              },
              update: {
                valueId:   av.valueId   ?? null,
                textValue: av.textValue ?? null,
              },
            });
          }

          // Remove attribute associations that were dropped
          await prisma.variantAttribute.deleteMany({
            where: {
              variantId,
              attributeId: { notIn: [...incomingAttrIds] },
            },
          });
        }
      }

      // Return fully-loaded product with relational variant data
      const updated = await prisma.productVariant.findMany({
        where:   { productId },
        include: {
          variantAttributes: {
            include: { attribute: true, attributeValue: true },
            orderBy: { attribute: { displayOrder: 'asc' } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const withNames = updated.map(v => ({
        ...v,
        displayName: buildVariantDisplayName(v),
      }));
      res.json({ status: 'success', data: withNames });
    } catch (err: any) {
      console.error('[Product.saveVariants]', err);
      res.status(500).json({ error: err?.message ?? 'Failed to save variants' });
    }
  };

  // ── PATCH /api/products/:id/variants/:variantId ─────────────────────────────
  // Update a single variant inline (price, stock, sku, barcode, isActive)

  updateVariant = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id: productId, variantId } = req.params;
      const tenantId = req.user!.tenantId;

      const variant = await prisma.productVariant.findFirst({
        where: { id: variantId, product: { id: productId, tenantId } },
      });
      if (!variant) { res.status(404).json({ error: 'Variant not found' }); return; }

      const { price, stock, sku, barcode, isActive } = req.body;

      const updated = await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(price    !== undefined && { price:         price === '' || price === null ? null : Number(price) }),
          ...(stock    !== undefined && { stockQuantity: Number(stock) }),
          ...(sku      !== undefined && { sku:           sku?.trim()   || null }),
          ...(barcode  !== undefined && { barcode:       barcode?.trim() || null }),
          ...(isActive !== undefined && { isActive:      Boolean(isActive) }),
        },
      });

      // Trendyol sync queue — varyant fiyatı veya stoğu değiştiyse kuyruğa ekle
      if ((price !== undefined || stock !== undefined) && updated.barcode) {
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { price: true } });
        const priceVal = updated.price != null ? Number(updated.price) : Number(product?.price ?? 0);
        const qtyVal   = Number(updated.stockQuantity);
        syncQueue.enqueue({
          tenantId:  tenantId!,
          barcode:   updated.barcode,
          listPrice: priceVal,
          salePrice: priceVal,
          quantity:  Math.max(0, Math.round(qtyVal)),
        }).catch(() => {});
      }

      res.json({ status: 'success', data: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to update variant' });
    }
  };

  // ── POST /api/products/:id/variants/bulk ─────────────────────────────────────
  // Bulk operations: setPrice, adjustPricePercent, setStock, setActive

  bulkVariants = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id: productId } = req.params;
      const tenantId = req.user!.tenantId;
      const { action, value, variantIds } = req.body;

      const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
      if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

      const whereClause: any = { productId };
      if (Array.isArray(variantIds) && variantIds.length > 0) {
        whereClause.id = { in: variantIds };
      }

      if (action === 'setPrice') {
        await prisma.productVariant.updateMany({
          where: whereClause,
          data:  { price: Number(value) },
        });
      } else if (action === 'adjustPricePercent') {
        // Get variants and update individually
        const variants = await prisma.productVariant.findMany({ where: whereClause });
        const basePrice = Number(product.price);
        await Promise.all(variants.map(v => {
          const currentPrice = Number(v.price ?? basePrice);
          const newPrice = currentPrice * (1 + Number(value) / 100);
          return prisma.productVariant.update({
            where: { id: v.id },
            data:  { price: Math.round(newPrice * 100) / 100 },
          });
        }));
      } else if (action === 'setStock') {
        await prisma.productVariant.updateMany({
          where: whereClause,
          data:  { stockQuantity: Number(value) },
        });
      } else if (action === 'setActive') {
        await prisma.productVariant.updateMany({
          where: whereClause,
          data:  { isActive: Boolean(value) },
        });
      } else {
        res.status(400).json({ error: 'Unknown bulk action' }); return;
      }

      const variants = await prisma.productVariant.findMany({
        where: { productId },
        orderBy: { createdAt: 'asc' },
      });
      res.json({ status: 'success', data: variants });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed bulk action' });
    }
  };

  // ── PATCH /api/products/bulk/category ────────────────────────────────────

  bulkCategory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { ids, categoryId } = req.body as { ids?: string[]; categoryId?: string | null };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids dizisi zorunludur.' }); return;
      }
      if (ids.length > 500) {
        res.status(400).json({ error: 'En fazla 500 ürün güncellenebilir.' }); return;
      }

      if (categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
        if (!cat) { res.status(404).json({ error: 'Kategori bulunamadı.' }); return; }
      }

      const result = await prisma.product.updateMany({
        where: { id: { in: ids }, tenantId },
        data:  { categoryId: categoryId ?? null },
      });

      await invalidateCache(`products:${tenantId}:*`);
      res.json({ status: 'success', updated: result.count });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Toplu kategori atama başarısız.' });
    }
  };

  // ── PATCH /api/products/bulk/price ────────────────────────────────────────

  bulkPrice = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { ids, action, value } = req.body as {
        ids?:   string[];
        action: 'percent_increase' | 'percent_decrease' | 'fixed_increase' | 'fixed_decrease' | 'set';
        value:  number;
      };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids dizisi zorunludur.' }); return;
      }
      if (typeof value !== 'number' || isNaN(value) || value < 0) {
        res.status(400).json({ error: 'Geçersiz değer.' }); return;
      }
      const validActions = ['percent_increase', 'percent_decrease', 'fixed_increase', 'fixed_decrease', 'set'];
      if (!validActions.includes(action)) {
        res.status(400).json({ error: 'Geçersiz işlem tipi.' }); return;
      }

      const products = await prisma.product.findMany({
        where:   { id: { in: ids }, tenantId },
        include: { pricing: true },
      });

      let updatedCount = 0;
      for (const p of products) {
        const currentPrice = p.pricing?.salePrice ? Number(p.pricing.salePrice) : Number(p.price ?? 0);
        let newPrice: number;

        switch (action) {
          case 'percent_increase': newPrice = currentPrice * (1 + value / 100); break;
          case 'percent_decrease': newPrice = currentPrice * (1 - value / 100); break;
          case 'fixed_increase':   newPrice = currentPrice + value;              break;
          case 'fixed_decrease':   newPrice = currentPrice - value;              break;
          case 'set':
          default:                 newPrice = value;
        }

        newPrice = Math.max(0, Math.round(newPrice * 100) / 100);

        await prisma.product.update({ where: { id: p.id }, data: { price: newPrice } });
        await prisma.productPrice.upsert({
          where:  { productId: p.id },
          create: { productId: p.id, salePrice: newPrice, vatRate: 18, currency: 'TRY' },
          update: { salePrice: newPrice },
        });
        updatedCount++;
      }

      // Trendyol sync queue — barkodlu ürünleri kuyruğa ekle (fire & forget)
      const toQueue = products
        .filter(p => p.barcode)
        .map(p => {
          const newPrice = (() => {
            const cur = p.pricing?.salePrice ? Number(p.pricing.salePrice) : Number(p.price ?? 0);
            switch (action) {
              case 'percent_increase': return Math.max(0, Math.round(cur * (1 + value / 100) * 100) / 100);
              case 'percent_decrease': return Math.max(0, Math.round(cur * (1 - value / 100) * 100) / 100);
              case 'fixed_increase':   return Math.max(0, Math.round((cur + value) * 100) / 100);
              case 'fixed_decrease':   return Math.max(0, Math.round((cur - value) * 100) / 100);
              default:                 return Math.max(0, value);
            }
          })();
          return { tenantId: tenantId!, barcode: p.barcode!, listPrice: newPrice, salePrice: newPrice, quantity: 0 };
        });
      if (toQueue.length > 0) {
        syncQueue.enqueueBatch(toQueue).catch(() => {});
      }

      await invalidateCache(`products:${tenantId}:*`);
      res.json({ status: 'success', updated: updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Toplu fiyat güncelleme başarısız.' });
    }
  };

  // ── POST /api/products/bulk-price-update ─────────────────────────────────
  // Full bulk price update: supports percentage / fixed increase on product
  // price AND/OR all variant prices, with optional tax inclusion.

  bulkPriceUpdate = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;

      const {
        productIds,
        type,
        value,
        applyTo     = 'product',
        includeTax  = false,
      } = req.body as {
        productIds:  string[];
        type:        'percentage' | 'fixed';
        value:       number;
        applyTo?:    'product' | 'variants' | 'both';
        includeTax?: boolean;
      };

      // ── Validation ──────────────────────────────────────────────────────────
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'productIds dizisi zorunludur.' }); return;
      }
      if (!['percentage', 'fixed'].includes(type)) {
        res.status(400).json({ error: 'type "percentage" veya "fixed" olmalıdır.' }); return;
      }
      if (typeof value !== 'number' || isNaN(value)) {
        res.status(400).json({ error: 'Geçersiz değer.' }); return;
      }
      if (value === 0) {
        res.status(400).json({ error: 'Değer 0 olamaz.' }); return;
      }

      // ── Helper: compute new price ────────────────────────────────────────────
      const calc = (base: number): number => {
        let newPrice: number;
        if (type === 'percentage') {
          newPrice = base * (1 + value / 100);
        } else {
          newPrice = base + value;
        }
        // Include tax: gross up the net price by 18% VAT if requested
        if (includeTax) newPrice = newPrice * 1.18;
        return Math.max(0, Math.round(newPrice * 100) / 100);
      };

      // ── Fetch products (tenant-scoped) ───────────────────────────────────────
      const needVariants = applyTo === 'variants' || applyTo === 'both';
      const products = await prisma.product.findMany({
        where:   { id: { in: productIds }, tenantId },
        include: {
          pricing:  true,
          variants: needVariants,   // only load variants if we need them
        },
      });

      if (products.length === 0) {
        res.status(404).json({ error: 'Seçili ürünler bulunamadı.' }); return;
      }

      // ── Apply updates in a single transaction ────────────────────────────────
      let updatedProducts = 0;
      let updatedVariants = 0;

      await prisma.$transaction(async (tx) => {
        for (const p of products) {
          const basePrice = Number(p.price ?? 0);

          // ── Product-level price ────────────────────────────────────────────
          if (applyTo === 'product' || applyTo === 'both') {
            const np = calc(basePrice);
            await tx.product.update({ where: { id: p.id }, data: { price: np } });
            // Keep ProductPrice in sync
            await tx.productPrice.upsert({
              where:  { productId: p.id },
              create: { productId: p.id, salePrice: np, vatRate: 18, currency: 'TRY' },
              update: { salePrice: np },
            });
            updatedProducts++;
          }

          // ── Variant-level prices ───────────────────────────────────────────
          if (needVariants && (p as any).variants?.length) {
            for (const v of (p as any).variants as Array<{ id: string; price: any }>) {
              // If variant has no own price → inherit product base price
              const varBase = v.price !== null ? Number(v.price) : basePrice;
              const nvp = calc(varBase);
              await tx.productVariant.update({
                where: { id: v.id },
                data:  { price: nvp },
              });
              updatedVariants++;
            }
          }
        }
      });

      await invalidateCache(`products:${tenantId}:*`);

      res.json({
        success:         true,
        updatedCount:    updatedProducts,
        updatedVariants,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Toplu fiyat güncelleme başarısız.' });
    }
  };

  // ── PATCH /api/products/bulk/stock ────────────────────────────────────────

  bulkStock = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { ids, action, value } = req.body as {
        ids?:   string[];
        action: 'set' | 'increase' | 'decrease';
        value:  number;
      };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids dizisi zorunludur.' }); return;
      }
      if (typeof value !== 'number' || isNaN(value) || value < 0) {
        res.status(400).json({ error: 'Geçersiz değer.' }); return;
      }
      if (!['set', 'increase', 'decrease'].includes(action)) {
        res.status(400).json({ error: 'Geçersiz işlem tipi.' }); return;
      }

      const products = await prisma.product.findMany({
        where:   { id: { in: ids }, tenantId },
        include: { stock: true },
      });

      let updatedCount = 0;
      for (const p of products) {
        const currentQty = p.stock ? Number((p.stock as any).quantity) : 0;
        let newQty: number;

        switch (action) {
          case 'set':      newQty = value; break;
          case 'increase': newQty = currentQty + value; break;
          case 'decrease': newQty = Math.max(0, currentQty - value); break;
          default:         newQty = currentQty;
        }

        if (p.stock) {
          await prisma.stock.update({ where: { productId: p.id }, data: { quantity: newQty } });
        } else {
          await prisma.stock.create({ data: { productId: p.id, tenantId, quantity: newQty, unit: (p as any).unit ?? 'adet' } });
        }
        updatedCount++;
      }

      await invalidateCache(`products:${tenantId}:*`);
      res.json({ status: 'success', updated: updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Toplu stok güncelleme başarısız.' });
    }
  };

  // ── POST /api/products/upload-image ───────────────────────────────────────

  uploadImage = async (req: AuthRequest, res: Response): Promise<void> => {
    productImageUploader(req as Request, res, (err: any) => {
      if (err) { res.status(400).json({ error: err.message ?? 'Upload failed' }); return; }
      if (!req.file) { res.status(400).json({ error: 'Dosya seçilmedi' }); return; }
      const url = `${BASE_URL()}/uploads/products/${req.file.filename}`;
      res.json({ status: 'success', url });
    });
  };

  // ── PUT /api/products/:id/barcode ─────────────────────────────────────────
  // Manual barcode override.  Lets users set/change their own barcode.
  // • If the product has a user-set barcode (isAutoBarcode = false) the
  //   caller must pass forceOverride: true to change it.
  // • Setting barcode to "" or null clears it (system will re-auto-generate
  //   next time the product is sent to Trendyol).

  updateBarcode = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId  = req.user!.tenantId;
      const productId = req.params.id;
      const { barcode, forceOverride = false } = req.body as {
        barcode:       string | null;
        forceOverride?: boolean;
      };

      const product = await prisma.product.findFirst({
        where:  { id: productId, tenantId },
        select: { id: true, barcode: true, isAutoBarcode: true },
      });
      if (!product) { res.status(404).json({ error: 'Ürün bulunamadı.' }); return; }

      if (!canOverrideBarcode(product, forceOverride)) {
        res.status(409).json({
          error: 'Bu ürünün barkodu kullanıcı tarafından girilmiş ve değiştirilemez. Zorla değiştirmek için forceOverride: true gönderin.',
        });
        return;
      }

      // If a barcode value is provided, check global uniqueness
      if (barcode) {
        const conflict = await prisma.product.findFirst({
          where: { barcode, NOT: { id: productId } },
        });
        if (conflict) {
          res.status(409).json({ error: `Bu barkod (${barcode}) zaten başka bir ürüne ait.` });
          return;
        }
      }

      const updated = await prisma.product.update({
        where: { id: productId },
        data:  {
          barcode:       barcode || null,
          isAutoBarcode: !barcode,   // cleared → next send will auto-generate
        },
        select: { id: true, barcode: true, isAutoBarcode: true },
      });

      await invalidateCache(`products:${tenantId}:*`);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Barkod güncelleme başarısız.' });
    }
  };
}
