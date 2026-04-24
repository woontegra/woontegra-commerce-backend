import { Router } from 'express';
import { ReportsController } from './reports.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const reportsController = new ReportsController();

// All routes require authentication
router.use(authenticate);

// Reports endpoints
router.get('/overview',  reportsController.getOverview.bind(reportsController));
router.get('/sales',     reportsController.salesReport.bind(reportsController));
router.get('/products',  reportsController.productPerformance.bind(reportsController));
router.get('/customers', reportsController.customerAnalytics.bind(reportsController));
router.get('/export',    reportsController.exportCSV.bind(reportsController));

export default router;
