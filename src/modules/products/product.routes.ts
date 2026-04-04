import { Router } from 'express';
import { ProductController } from './product.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const productController = new ProductController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', productController.getAll);
router.get('/:id', productController.getById);
router.post('/', productController.create);
router.put('/:id', productController.update);
router.delete('/:id', productController.delete);

export default router;
