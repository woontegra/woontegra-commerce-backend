import { Router } from 'express';
import { CategoryController } from './category.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const categoryController = new CategoryController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', categoryController.getAll);
router.get('/:id', categoryController.getById);
router.post('/', categoryController.create);
router.put('/:id', categoryController.update);
router.delete('/:id', categoryController.delete);
router.get('/:id/products', categoryController.getProducts);

export default router;
