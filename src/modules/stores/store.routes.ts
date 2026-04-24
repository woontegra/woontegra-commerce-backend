import { Router } from 'express';
import { storeController } from './store.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Store routes
router.get('/', storeController.getAll.bind(storeController));
router.get('/:id', storeController.getById.bind(storeController));
router.post('/', storeController.create.bind(storeController));
router.put('/:id', storeController.update.bind(storeController));
router.delete('/:id', storeController.delete.bind(storeController));
router.patch('/:id/toggle', storeController.toggleActive.bind(storeController));
router.patch('/:id/set-default', storeController.setDefault.bind(storeController));
router.get('/:id/products', storeController.getProducts.bind(storeController));

export default router;
