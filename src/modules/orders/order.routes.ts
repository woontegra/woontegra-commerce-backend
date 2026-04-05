import { Router } from 'express';
import { OrderController } from './order.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const orderController = new OrderController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', orderController.getAll);
router.get('/:id', orderController.getById);
router.post('/', orderController.create);
router.patch('/:id', orderController.updateStatus);
router.delete('/:id', orderController.delete);
router.get('/customer/:customerId', orderController.getByCustomer);

export default router;
