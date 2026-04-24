import { Router } from 'express';
import { requireSuperAdmin } from '../../common/middleware/superAdmin.middleware';
import {
  getTenants,
  getTenantById,
  suspendTenant,
  activateTenant,
  deleteTenant,
  overrideSubscription,
  extendSubscription,
  getUsers,
  banUser,
  unbanUser,
  getMetrics,
  getAuditLogs,
  changeTenantStatus,
} from './admin.controller';

const router = Router();

// All admin routes require SUPER_ADMIN role
router.use(requireSuperAdmin);

// ── Dashboard metrics ─────────────────────────────────────────────────────────
router.get('/metrics', getMetrics);

// ── Tenant management ─────────────────────────────────────────────────────────
router.get('/tenants',           getTenants);
router.get('/tenants/:id',       getTenantById);
router.post('/tenant/suspend',   suspendTenant);
router.post('/tenant/activate',  activateTenant);
router.post('/tenant/status',    changeTenantStatus);
router.delete('/tenant/:id',     deleteTenant);

// ── Subscription override ─────────────────────────────────────────────────────
router.post('/subscription/change',           overrideSubscription);
router.post('/tenant/extend-subscription',    extendSubscription);

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',       getUsers);
router.post('/user/ban',   banUser);
router.post('/user/unban', unbanUser);

// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

export default router;
