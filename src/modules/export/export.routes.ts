import { Router } from 'express';
import { exportController } from './export.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/orders', exportController.exportOrders.bind(exportController));
router.get('/products', exportController.exportProducts.bind(exportController));
router.get('/customers', exportController.exportCustomers.bind(exportController));
router.get('/analytics', exportController.exportAnalytics.bind(exportController));

export default router;
