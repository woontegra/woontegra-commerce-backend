import { Router } from 'express';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { tenantLifecycleGuard } from '../lifecycle/lifecycle.middleware';
import { deleteMedia, listMedia, uploadMedia } from './media.controller';

const router = Router();

router.use(authenticate, requireTenantAccess, tenantLifecycleGuard);

router.get('/', listMedia);
router.post('/upload', uploadMedia);
router.delete('/:id', deleteMedia);

export default router;
