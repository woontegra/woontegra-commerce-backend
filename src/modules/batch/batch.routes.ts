import { Router } from 'express';
import { batchController } from './batch.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.post('/', batchController.createBatchJob.bind(batchController));
router.get('/:jobId', batchController.getBatchJobStatus.bind(batchController));
router.post('/products/update', batchController.bulkUpdateProducts.bind(batchController));
router.post('/products/delete', batchController.bulkDeleteProducts.bind(batchController));
router.post('/products/import', batchController.bulkImportProducts.bind(batchController));

export default router;
