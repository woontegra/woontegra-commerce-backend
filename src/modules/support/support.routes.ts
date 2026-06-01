import { Router } from 'express';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { tenantLifecycleGuard } from '../lifecycle/lifecycle.middleware';
import { createSupportTicket, getSupportTickets } from './support.controller';

const router = Router();

router.use(authenticate, requireTenantAccess, tenantLifecycleGuard);

router.get('/tickets', getSupportTickets);
router.post('/ticket', createSupportTicket);

export default router;
