import { Router } from 'express';
import { analyticsController } from './analytics.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/sales', analyticsController.getSalesAnalytics.bind(analyticsController));
router.get('/products', analyticsController.getProductSalesReport.bind(analyticsController));
router.get('/categories', analyticsController.getRevenueByCategory.bind(analyticsController));
router.get('/hourly', analyticsController.getHourlySales.bind(analyticsController));
router.get('/customers', analyticsController.getCustomerAnalytics.bind(analyticsController));

export default router;
