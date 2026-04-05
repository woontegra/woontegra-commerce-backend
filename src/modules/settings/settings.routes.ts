import { Router } from 'express';
import { SettingsController } from './settings.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const settingsController = new SettingsController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', settingsController.get);
router.put('/', settingsController.update);

export default router;
