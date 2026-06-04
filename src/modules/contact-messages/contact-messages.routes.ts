import { Router } from 'express';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';
import { ContactMessagesController } from './contact-messages.controller';

const router = Router();
const controller = new ContactMessagesController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.patch('/:id/status', controller.updateStatus);

export default router;
