import { Router } from 'express';
import { SupportController } from './support.controller';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { rateLimitConfigs, createRateLimit } from '../../common/middleware/rateLimit.middleware';
import { asyncHandler } from '../../common/middleware/errorHandler';

const router = Router();
const supportController = new SupportController();

// Apply rate limiting to support endpoints
const supportRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many support requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes (with authentication)
router.post('/ticket', authenticate, requireTenantAccess, supportRateLimit, supportController.createTicket);
router.get('/tickets', authenticate, requireTenantAccess, supportController.getTickets);
router.get('/ticket/:id', authenticate, requireTenantAccess, supportController.getTicket);
router.post('/message', authenticate, requireTenantAccess, supportRateLimit, supportController.addMessage);
router.post('/close', authenticate, requireTenantAccess, supportController.closeTicket);
router.get('/stats', authenticate, requireTenantAccess, supportController.getTicketStats);

// Admin routes (with admin role check)
router.post('/internal-message', authenticate, requireTenantAccess, supportRateLimit, supportController.addInternalMessage);

export default router;
