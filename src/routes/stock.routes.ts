import { Router } from 'express';
import { StockController } from '../controllers/stock.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all stock routes
router.use(authenticateToken);

// Stock Management
router.get('/', StockController.getStocks);
router.get('/stats', StockController.getStockStats);
router.get('/product/:productId', StockController.getStock);
router.put('/product/:productId', StockController.updateStock);
router.put('/bulk', StockController.bulkUpdateStocks);
router.post('/reserve', StockController.reserveStock);
router.post('/release', StockController.releaseStock);
router.post('/consume', StockController.consumeStock);

export default router;
