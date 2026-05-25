import { Router } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import { requireSuperAdmin } from '../../common/middleware/superAdmin.middleware';
import { leadController } from './lead.controller';

const router = Router();

router.post('/', leadController.create);
router.get('/', authenticate, requireSuperAdmin, leadController.list);

export default router;
