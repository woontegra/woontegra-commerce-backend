import { Router } from 'express';
import { checkPlanFeature } from '../features/feature.middleware';
import {
  getShippingDefaults,
  saveShippingDefaults,
  getCargoCompanies,
  getIntegration,
  saveIntegration,
  testConnection,
  getStats,
  getTrendyolCategories,
  getTrendyolCategoryAttributes,
  getLocalCategories,
  getLocalAttributes,
  getCategoryMapping,
  saveCategoryMapping,
  getAttributeMapping,
  saveAttributeMapping,
  getProducts,
  validateProducts,
  sendProducts,
  syncPriceStock,
  manualPriceStockUpdate,
  getMappedProductsWithVariants,
  removeProductMap,
  getSyncHistory,
  bulkSendProducts,
  getBatchStatus,
  retryFailed,
  resetTrendyolRecords,
  getIntegrationLogs,
  getTrendyolBrands,
  createTrendyolBrand,
  getBrandMapping,
  saveBrandMapping,
  getLocalBrands,
  getPriceStrategy,
  savePriceStrategy,
  getProductPriceOverride,
  saveProductPriceOverride,
  deleteProductPriceOverride,
  getMappedCategories,
  getCategoryProductIds,
  getTrendyolBatchResult,
  getRecentTrendyolBatches,
  syncTrendyolOrders,
  getTrendyolOrders,
  getTrendyolOrderDetail,
  processSyncQueueManual,
  getSyncQueueStats,
  retrySyncQueue,
  getProductSettings,
  saveProductSettings,
  deleteProductSettings,
} from './trendyol.controller';

const router = Router();

// All Trendyol routes require PRO+ plan
const trendyolGate = checkPlanFeature('trendyol');

// Setup
router.get   ('/integration',       trendyolGate, getIntegration);
router.post  ('/integration',       trendyolGate, saveIntegration);
router.post  ('/integration/test',  trendyolGate, testConnection);
router.get   ('/stats',             trendyolGate, getStats);

// Category / Attribute helpers
router.get   ('/trendyol-categories',                          trendyolGate, getTrendyolCategories);
router.get   ('/trendyol-categories/:categoryId/attributes',   trendyolGate, getTrendyolCategoryAttributes);
router.get   ('/local-categories',                             trendyolGate, getLocalCategories);
router.get   ('/local-attributes',                             trendyolGate, getLocalAttributes);

// Mappings
router.get   ('/category-mapping',  trendyolGate, getCategoryMapping);
router.post  ('/category-mapping',  trendyolGate, saveCategoryMapping);
router.get   ('/attribute-mapping', trendyolGate, getAttributeMapping);
router.post  ('/attribute-mapping', trendyolGate, saveAttributeMapping);

// Products
router.get   ('/products',                         trendyolGate, getProducts);
router.get   ('/products/mapped-categories',       trendyolGate, getMappedCategories);
router.get   ('/products/category-ids',            trendyolGate, getCategoryProductIds);
router.get   ('/products/mapped-with-variants',    trendyolGate, getMappedProductsWithVariants);
router.post  ('/products/validate',                trendyolGate, validateProducts);
router.post  ('/products/send',                    trendyolGate, sendProducts);
// Alias: POST /trendyol/products → same as /products/send
router.post  ('/products',                         trendyolGate, sendProducts);
router.post  ('/products/sync-price-stock',        trendyolGate, syncPriceStock);
router.delete('/products/:productId/map',          trendyolGate, removeProductMap);

// Manual price/stock update (explicit values, supports variants)
router.post  ('/price-stock-update',               trendyolGate, manualPriceStockUpdate);

// Shipping defaults + cargo companies
router.get   ('/cargo-companies',    trendyolGate, getCargoCompanies);
router.get   ('/shipping-defaults',  trendyolGate, getShippingDefaults);
router.post  ('/shipping-defaults',  trendyolGate, saveShippingDefaults);

// Brand mapping
router.get   ('/trendyol-brands',   trendyolGate, getTrendyolBrands);
router.post  ('/trendyol-brands',   trendyolGate, createTrendyolBrand);
router.get   ('/brand-mapping',     trendyolGate, getBrandMapping);
router.post  ('/brand-mapping',     trendyolGate, saveBrandMapping);
router.get   ('/local-brands',      trendyolGate, getLocalBrands);

// Bulk send + progress polling
router.post  ('/products/bulk-send',       trendyolGate, bulkSendProducts);
router.post  ('/products/retry-failed',    trendyolGate, retryFailed);
router.post  ('/products/reset-trendyol',  trendyolGate, resetTrendyolRecords);
router.get   ('/batches/:batchId',         trendyolGate, getBatchStatus);

// Integration logs
router.get   ('/logs',                          trendyolGate, getIntegrationLogs);
router.get   ('/trendyol-batches/recent',       trendyolGate, getRecentTrendyolBatches);
router.get   ('/trendyol-batch/:batchRequestId', trendyolGate, getTrendyolBatchResult);

// History
router.get   ('/sync-history', trendyolGate, getSyncHistory);

// ── Ürün Bazlı Trendyol Ayarları ─────────────────────────────────────────────
router.get   ('/product-settings/:productId', trendyolGate, getProductSettings);
router.post  ('/product-settings',            trendyolGate, saveProductSettings);
router.delete('/product-settings/:productId', trendyolGate, deleteProductSettings);

// ── Fiyat/Stok Sync Queue ─────────────────────────────────────────────────────
router.post  ('/sync-queue/process',  trendyolGate, processSyncQueueManual);
router.post  ('/sync-queue/retry',    trendyolGate, retrySyncQueue);
router.get   ('/sync-queue/stats',    trendyolGate, getSyncQueueStats);

// ── Sipariş Sync ──────────────────────────────────────────────────────────────
router.post  ('/orders/sync',         trendyolGate, syncTrendyolOrders);
router.get   ('/orders',              trendyolGate, getTrendyolOrders);
router.get   ('/orders/:orderNumber', trendyolGate, getTrendyolOrderDetail);

// Price strategy (global)
router.get   ('/price-strategy',  trendyolGate, getPriceStrategy);
router.post  ('/price-strategy',  trendyolGate, savePriceStrategy);

// Per-product price override
router.get   ('/price-override/:productId',    trendyolGate, getProductPriceOverride);
router.post  ('/price-override/:productId',    trendyolGate, saveProductPriceOverride);
router.delete('/price-override/:productId',    trendyolGate, deleteProductPriceOverride);

export default router;
