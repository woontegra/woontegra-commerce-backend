import { Router } from 'express';
import { ProductController } from './product.controller';
import { ProductFilterController } from './product-filter.controller';
import { ProductFilterService } from './product-filter.service';
import { PrismaClient } from '@prisma/client';
import { validate, schemas } from '../../common/middleware/validation.middleware';
import { cacheMiddleware } from '../../common/middleware/cache.middleware';
import { xmlUploader, importXml, previewXml, importHistory, previewXmlFromUrl, importXmlFromUrl, importXmlStream, importXmlFromUrlStream } from './xml-import.controller';
import { exportXml } from './xml-export.controller';

// Note: authenticate + requireTenantAccess + tenantLifecycleGuard are applied
// globally in main.ts — do NOT add them again here (causes double DB queries)

const router = Router();
const ctrl   = new ProductController();
const prisma = new PrismaClient();
const filterService = new ProductFilterService(prisma);
const filterCtrl = new ProductFilterController(filterService);

// XML import — must be before /:id routes
const withXmlUpload = (handler: any) => (req: any, res: any) =>
  xmlUploader(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message });
    handler(req, res);
  });

router.post('/import/xml/preview',      withXmlUpload(previewXml));
router.post('/import/xml',              withXmlUpload(importXml));
// Streaming imports (NDJSON progress events)
router.post('/import/xml/stream',       withXmlUpload(importXmlStream));
router.post('/import/xml/stream-url',   importXmlFromUrlStream as any);
// URL-based import (no file upload needed)
router.post('/import/xml/preview-url', previewXmlFromUrl as any);
router.post('/import/xml/from-url',    importXmlFromUrl  as any);
router.get ('/import/history',     importHistory as any);
router.get ('/export/xml',         exportXml     as any);

// Image upload — must be before /:id routes
router.post('/upload-image', ctrl.uploadImage);

// Bulk operations — must be before /:id routes
router.patch('/bulk/category',       ctrl.bulkCategory);
router.patch('/bulk/price',          ctrl.bulkPrice);
router.patch('/bulk/stock',          ctrl.bulkStock);
router.post ('/bulk-price-update',   ctrl.bulkPriceUpdate);  // enhanced: variant + tax support

// Filter endpoints — must be before /:id routes
router.get('/filter',         cacheMiddleware({ ttl: 60, keyPrefix: 'products-filter' }), filterCtrl.getFilteredProducts.bind(filterCtrl));
router.get('/filter/options', cacheMiddleware({ ttl: 300, keyPrefix: 'filter-options' }), filterCtrl.getFilterOptions.bind(filterCtrl));

// Standard CRUD
router.get ('/',            cacheMiddleware({ ttl: 300, keyPrefix: 'products' }),     ctrl.getAll);
router.get ('/slug/:slug',  cacheMiddleware({ ttl: 600, keyPrefix: 'product-slug' }), (req, res) => ctrl.getBySlug(req, res));
router.get ('/:id',         cacheMiddleware({ ttl: 600, keyPrefix: 'product' }),      ctrl.getById);
router.post('/',            validate(schemas.createProduct),                           ctrl.create);
router.put ('/:id',         validate(schemas.updateProduct),                           ctrl.update);
router.patch('/:id',        validate(schemas.updateProduct),                           ctrl.patch);
router.patch('/:id/quick',                                                              ctrl.quickUpdate);
router.put  ('/:id/barcode',                                                            ctrl.updateBarcode);
router.delete('/:id',                                                                  ctrl.delete);

// ── Domain sub-resource routes ────────────────────────────────────────────────

// Variants
router.get   ('/:id/variants',                  ctrl.getVariants);
router.put   ('/:id/variants',                  ctrl.saveVariants);
router.patch ('/:id/variants/:variantId',        ctrl.updateVariant);  // single variant inline edit
router.post  ('/:id/variants/bulk',              ctrl.bulkVariants);   // bulk: setPrice|adjustPricePercent|setStock|setActive

// Pricing
router.put ('/:id/pricing',  ctrl.savePricing);

// Shipping
router.put ('/:id/shipping', ctrl.saveShipping);

// Images (ordered list)
router.put ('/:id/images',   ctrl.saveImages);

// Stock
router.put ('/:id/stock',    ctrl.saveStock);

export default router;
