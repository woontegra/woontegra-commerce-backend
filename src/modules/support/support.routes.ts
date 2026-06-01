import { Router } from 'express';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { tenantLifecycleGuard } from '../lifecycle/lifecycle.middleware';
import {
  addSupportTicketMessage,
  createSupportTicket,
  getSupportTicketById,
  getSupportTickets,
} from './support.controller';

const router = Router();

router.use(authenticate, requireTenantAccess, tenantLifecycleGuard);

router.get('/tickets', getSupportTickets);
router.get('/tickets/:id', getSupportTicketById);
router.post('/tickets/:id/messages', addSupportTicketMessage);
router.post('/ticket', createSupportTicket);

export default router;
