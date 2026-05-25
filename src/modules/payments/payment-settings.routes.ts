import { Router } from 'express';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import * as ctrl from './payment-settings.controller';

const router = Router();

router.use(authenticate, requireTenantAccess);

router.get('/', ctrl.listPaymentSettings);
router.put('/:provider', ctrl.upsertPaymentSetting);

export default router;
