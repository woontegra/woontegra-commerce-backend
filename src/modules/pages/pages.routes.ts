import { Router } from 'express';
import { PagesController } from './pages.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const pagesController = new PagesController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', pagesController.getAll);
router.get('/:id', pagesController.getById);
router.post('/', pagesController.create);
router.put('/:id', pagesController.update);
router.delete('/:id', pagesController.delete);

export default router;
