import { Router } from 'express';
import { returnRequestController } from './return-request.controller';
import { returnRefundController } from './return-refund.controller';

const router = Router();

router.patch('/refunds/:refundId/cancel', returnRefundController.cancel);
router.get('/', returnRequestController.list);
router.get('/order/:orderId', returnRequestController.listByOrder);
router.get('/:id/refunds', returnRefundController.list);
router.post('/:id/refunds', returnRefundController.create);
router.get('/:id', returnRequestController.getById);
router.patch('/:id/status', returnRequestController.updateStatus);

export default router;
