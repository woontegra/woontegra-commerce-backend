import { Router } from 'express';
import { stockSyncController } from './stock-sync.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication and tenant access
router.use(authenticate);

router.get('/marketplaces', stockSyncController.getMarketplaces.bind(stockSyncController));
router.post('/products', stockSyncController.getStockProducts.bind(stockSyncController));
router.post('/sync/all', stockSyncController.syncAllMarketplaces.bind(stockSyncController));
router.post('/sync/marketplace', stockSyncController.syncMarketplace.bind(stockSyncController));
router.post('/test-connection', stockSyncController.testConnection.bind(stockSyncController));
router.get('/history', stockSyncController.getSyncHistory.bind(stockSyncController));
router.post('/trigger-update', stockSyncController.triggerStockUpdate.bind(stockSyncController));

export default router;
