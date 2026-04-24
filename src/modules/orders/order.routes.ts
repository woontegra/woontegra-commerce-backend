import { Router } from 'express';
import { OrderController } from './order.controller';

// Auth + tenant guard is applied globally in main.ts for /api/orders
const router = Router();
const ctrl   = new OrderController();

router.get('/',                    ctrl.getAll);
router.get('/stats',               ctrl.getStats);
router.get('/customer/:customerId', ctrl.getByCustomer);
router.get('/:id',                 ctrl.getById);
router.post('/',                   ctrl.create);
router.patch('/:id/status',        ctrl.updateStatus);
router.delete('/:id',              ctrl.delete);

export default router;
