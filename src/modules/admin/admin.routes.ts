import { Router } from 'express';
import { requireSuperAdmin, requireStrictSuperAdmin } from '../../common/middleware/superAdmin.middleware';
import {
  getTenants,
  getTenantDetail,
  getTenantUsage,
  getTenantById,
  patchTenantStatus,
  createTenant,
  updateTenantDomains,
  verifyTenantDomain,
  suspendTenant,
  activateTenant,
  deleteTenant,
  overrideSubscription,
  extendSubscription,
  getUsers,
  createUser,
  updateUser,
  patchUserStatus,
  patchUserPlan,
  banUser,
  unbanUser,
  getMetrics,
  getAuditLogs,
  changeTenantStatus,
  getBillingOverview,
  getLogsActivity,
  getLogsErrors,
  getLogsWebhooks,
  impersonateStart,
  impersonateStop,
  recordManualPayment,
  patchSubscriptionByTenant,
  setSubscriptionStatus,
} from './admin.controller';

const router = Router();

// Impersonation (stop uses tenant token — must run before global requireSuperAdmin)
router.post('/impersonate',      requireStrictSuperAdmin, impersonateStart);
router.post('/impersonate/stop', impersonateStop);

// All other admin routes require SUPER_ADMIN only
router.use(requireSuperAdmin);

// ── Dashboard metrics ─────────────────────────────────────────────────────────
router.get('/metrics', getMetrics);

// ── Tenant management ─────────────────────────────────────────────────────────
router.post('/tenants',          createTenant);
router.patch('/tenants/:id/status', patchTenantStatus);
router.post('/tenants/:id/domains/verify', verifyTenantDomain);
router.patch('/tenants/:id/domains', updateTenantDomains);
router.get('/tenants',           getTenants);
router.get('/tenants/:id/detail', getTenantDetail);
router.get('/tenants/:id/usage',  getTenantUsage);
router.get('/tenants/:id',       getTenantById);
router.post('/tenant/suspend',   suspendTenant);
router.post('/tenant/activate',  activateTenant);
router.post('/tenant/status',    changeTenantStatus);
router.delete('/tenant/:id',     deleteTenant);

// ── Subscription override ─────────────────────────────────────────────────────
router.patch('/subscription/:tenantId', patchSubscriptionByTenant);
router.post('/subscription/change',           overrideSubscription);
router.post('/tenant/extend-subscription',    extendSubscription);

// ── Billing overview ──────────────────────────────────────────────────────────
router.get('/billing/overview', getBillingOverview);
router.post('/billing/manual-payment', recordManualPayment);
router.patch('/billing/subscriptions/:id/status', setSubscriptionStatus);

// ── Platform logs ─────────────────────────────────────────────────────────────
router.get('/logs/activity',  getLogsActivity);
router.get('/logs/errors',   getLogsErrors);
router.get('/logs/webhooks', getLogsWebhooks);

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',        getUsers);
router.post('/users',       createUser);
router.patch('/users/:id/status', patchUserStatus);
router.patch('/users/:id/plan',   patchUserPlan);
router.patch('/users/:id',  updateUser);
router.post('/user/ban',   banUser);
router.post('/user/unban', unbanUser);

// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

export default router;
