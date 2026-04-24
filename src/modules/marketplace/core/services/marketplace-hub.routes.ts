/**
 * Marketplace Hub Routes
 * Mount: /api/marketplace-hub
 *
 * Tüm pazaryerleri için tek, provider-agnostic API.
 * Mevcut /api/trendyol/* route'larına dokunulmaz.
 */

import { Router } from 'express';
import { authenticate } from '../../../../common/middleware/authEnhanced';
import {
  listMarketplaces,
  getMarketplaceStatus,
  testConnection,
  sendProducts,
  updateStockAndPrice,
  fetchOrders,
} from './marketplace-hub.controller';

const router = Router();

// Tüm endpoint'ler auth gerektirir
router.use(authenticate);

// ── Hub ───────────────────────────────────────────────────────────────────────
router.get('/',                               listMarketplaces);

// ── Slug-based ────────────────────────────────────────────────────────────────
router.get ('/:slug/status',                  getMarketplaceStatus);
router.post('/:slug/test-connection',         testConnection);
router.post('/:slug/send-products',           sendProducts);
router.post('/:slug/update-stock-price',      updateStockAndPrice);
router.get ('/:slug/orders',                  fetchOrders);

export default router;
