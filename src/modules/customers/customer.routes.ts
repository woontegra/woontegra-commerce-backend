import { Router } from 'express';
import { CustomerController } from './customer.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const customerController = new CustomerController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', customerController.getAll);
router.get('/:id', customerController.getById);
router.post('/', customerController.create);
router.put('/:id', customerController.update);
router.delete('/:id', customerController.delete);

export default router;
