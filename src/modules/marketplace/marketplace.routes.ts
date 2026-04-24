import { Router } from 'express';
import { MarketplaceController } from './marketplace.controller';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const prisma = new PrismaClient();
const marketplaceController = new MarketplaceController(
  // Marketplace service will be injected via dependency injection
  {} as any,
  prisma
);

// Apply authentication middleware to all routes
router.use(authenticate);

// CONNECTION ROUTES
router.post('/connect',    (req, res) => marketplaceController.connectMarketplace(req, res));
router.post('/disconnect', (req, res) => marketplaceController.disconnectMarketplace(req, res));
router.get('/accounts',   (req, res) => marketplaceController.getMarketplaceAccounts(req, res));

// PRODUCT EXPORT ROUTES
router.post('/export-product',  (req, res) => marketplaceController.exportProduct(req, res));
router.post('/export-products', (req, res) => marketplaceController.exportMultipleProducts(req, res));

// STOCK & PRICE SYNC ROUTES
router.post('/update-stock-price',     (req, res) => marketplaceController.updateStockAndPrice(req, res));
router.post('/update-all-stock-price', (req, res) => marketplaceController.updateAllStockAndPrice(req, res));

// ORDER IMPORT ROUTES
router.post('/import-orders', (req, res) => marketplaceController.importOrders(req, res));
router.get('/orders',         (req, res) => marketplaceController.getOrders(req, res));

// SYNC LOGS & PRODUCT MAPS
router.get('/sync-logs',    (req, res) => marketplaceController.getSyncLogs(req, res));
router.get('/product-maps', (req, res) => marketplaceController.getProductMaps(req, res));

// HEALTH CHECK
router.get('/health', (req, res) => marketplaceController.healthCheck(req, res));

export { router as marketplaceRoutes };
