import { Router } from 'express';
import { OrderController } from './order.controller';
import { enforceOrderLimit } from '../../common/middleware/featureProtection';

// Auth + tenant guard is applied globally in main.ts for /api/orders
const router = Router();
const ctrl   = new OrderController();

router.get('/',                    ctrl.getAll);
router.get('/stats',               ctrl.getStats);
router.get('/customer/:customerId', ctrl.getByCustomer);
router.get('/:id/history',         ctrl.getHistory);
router.get('/:id',                 ctrl.getById);
router.post('/',                   enforceOrderLimit, ctrl.create);
router.patch('/:id/shipping',      ctrl.updateShipping);
router.post('/:id/invoice/upload', ctrl.uploadInvoicePdf);
router.patch('/:id/invoice',       ctrl.updateInvoice);
router.patch('/:id/status',        ctrl.updateStatus);
router.patch('/:id/confirm-payment', ctrl.confirmPayment);
router.delete('/:id',              ctrl.delete);

export default router;
