import { Router } from 'express';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { tenantLifecycleGuard } from '../lifecycle/lifecycle.middleware';
import {
  getHomeDraft,
  publishHome,
  saveHomeDraft,
} from './storefront-builder.controller';

const router = Router();

router.use(authenticate, requireTenantAccess, tenantLifecycleGuard);

router.get('/pages/home/draft', getHomeDraft);
router.put('/pages/home/draft', saveHomeDraft);
router.post('/pages/home/publish', publishHome);

export default router;
