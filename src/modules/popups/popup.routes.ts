import { Router } from 'express';
import { popupController } from './popup.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get active popup for storefront (public)
router.get('/active', popupController.getActive.bind(popupController));

// Admin routes
router.get('/', popupController.getAll.bind(popupController));
router.get('/:id', popupController.getById.bind(popupController));
router.post('/', popupController.create.bind(popupController));
router.put('/:id', popupController.update.bind(popupController));
router.delete('/:id', popupController.delete.bind(popupController));
router.patch('/:id/toggle', popupController.toggleActive.bind(popupController));

export default router;
