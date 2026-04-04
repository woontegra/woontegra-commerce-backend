import { Router } from 'express';
import { TenantController } from './tenant.controller';

const router = Router();
const tenantController = new TenantController();

router.post('/', tenantController.create);
router.get('/', tenantController.getAll);
router.get('/:id', tenantController.getById);

export default router;
