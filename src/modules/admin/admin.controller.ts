import { Request, Response } from 'express';
import { BillingCycle, Plan, PaymentStatus, UserRole, SubscriptionStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { logger } from '../../config/logger';

const adminService = new AdminService();

interface AdminRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '0.0.0.0';
}

function pagination(req: Request) {
  return {
    page:  Math.max(1, parseInt(req.query.page as string)  || 1),
    limit: Math.min(100, parseInt(req.query.limit as string) || 20),
  };
}

// ── POST /api/admin/tenants ───────────────────────────────────────────────────
export async function createTenant(req: AdminRequest, res: Response): Promise<void> {
  try {
    const {
      name, slug, subdomain, customDomain, domainVerified, owner,
      initialPlan, billingCycle, subscriptionEndDate,
    } = req.body ?? {};
    if (!name?.trim()) {
      res.status(400).json({ success: false, message: 'name gerekli.' });
      return;
    }
    const data = await adminService.createTenant(
      req.user!.userId,
      req.user!.email,
      {
        name, slug, subdomain, customDomain, domainVerified, owner,
        initialPlan, billingCycle, subscriptionEndDate,
      },
      getIp(req),
    );
    res.status(201).json({ success: true, data });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/tenants/:id/domains ──────────────────────────────────────
export async function updateTenantDomains(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { subdomain, customDomain, domainVerified } = req.body ?? {};
    const data = await adminService.updateTenantDomains(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      { subdomain, customDomain, domainVerified },
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/tenants/:id/domains/verify ────────────────────────────────
export async function verifyTenantDomain(req: AdminRequest, res: Response): Promise<void> {
  try {
    const domainId = (req.body as { domainId?: string })?.domainId;
    const data = await adminService.verifyTenantDomain(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      { domainId: String(domainId || '') },
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/tenants ────────────────────────────────────────────────────
export async function getTenants(req: AdminRequest, res: Response): Promise<void> {
  try {
    const result = await adminService.getTenants({
      ...pagination(req),
      search: req.query.search as string | undefined,
      status: (req.query.status as any) || 'all',
      plan:   req.query.plan as string | undefined,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error({ message: 'getTenants error', error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/tenants/:id/status ─────────────────────────────────────────
export async function patchTenantStatus(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ success: false, message: 'isActive (boolean) gerekli.' });
      return;
    }
    const data = await adminService.patchTenantActive(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      isActive,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/users/:id/status ─────────────────────────────────────────
export async function patchUserStatus(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ success: false, message: 'isActive (boolean) gerekli.' });
      return;
    }
    const data = await adminService.patchUserActive(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      isActive,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/users/:id/plan ───────────────────────────────────────────
export async function patchUserPlan(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { plan } = req.body ?? {};
    if (!plan || typeof plan !== 'string') {
      res.status(400).json({ success: false, message: 'plan gerekli (STARTER | PRO | ENTERPRISE).' });
      return;
    }
    const data = await adminService.patchUserPlan(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      plan as Plan,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/tenants/:id/detail ───────────────────────────────────────────
export async function getTenantDetail(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getTenantDetailForAdmin(String(req.params.id));
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message.includes('bulunamadı') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/tenants/:id/usage ───────────────────────────────────────────
export async function getTenantUsage(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getTenantUsageForAdmin(String(req.params.id));
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message.includes('bulunamadı') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/tenants/:id ────────────────────────────────────────────────
export async function getTenantById(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getTenantById(String(req.params.id));
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message.includes('bulunamadı') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/tenant/suspend ────────────────────────────────────────────
export async function suspendTenant(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, reason = '' } = req.body;
    if (!tenantId) { res.status(400).json({ success: false, message: 'tenantId gerekli.' }); return; }

    await adminService.suspendTenant(req.user!.userId, req.user!.email, tenantId, reason, getIp(req));
    res.json({ success: true, message: 'Tenant askıya alındı.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/tenant/activate ──────────────────────────────────────────
export async function activateTenant(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.body;
    if (!tenantId) { res.status(400).json({ success: false, message: 'tenantId gerekli.' }); return; }

    await adminService.activateTenant(req.user!.userId, req.user!.email, tenantId, getIp(req));
    res.json({ success: true, message: 'Tenant aktifleştirildi.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── DELETE /api/admin/tenant/:id ──────────────────────────────────────────────
export async function deleteTenant(req: AdminRequest, res: Response): Promise<void> {
  try {
    await adminService.deleteTenant(req.user!.userId, req.user!.email, String(req.params.id), getIp(req));
    res.json({ success: true, message: 'Tenant kalıcı olarak silindi.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/subscription/change ──────────────────────────────────────
export async function overrideSubscription(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, plan, billingCycle, endDate } = req.body;

    if (!tenantId || !plan || !billingCycle || !endDate) {
      res.status(400).json({ success: false, message: 'tenantId, plan, billingCycle, endDate gerekli.' });
      return;
    }

    if (!Object.values(Plan).includes(plan)) {
      res.status(400).json({ success: false, message: 'Geçersiz plan.' });
      return;
    }

    if (!Object.values(BillingCycle).includes(billingCycle)) {
      res.status(400).json({ success: false, message: 'Geçersiz billingCycle.' });
      return;
    }

    const parsedEnd = new Date(endDate);
    if (isNaN(parsedEnd.getTime())) {
      res.status(400).json({ success: false, message: 'Geçersiz endDate formatı.' });
      return;
    }

    const subscription = await adminService.overrideSubscription(
      req.user!.userId, req.user!.email, tenantId,
      plan as Plan, billingCycle as BillingCycle, parsedEnd, getIp(req),
    );

    res.json({ success: true, message: 'Abonelik güncellendi.', data: subscription });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/tenant/extend-subscription ───────────────────────────────
export async function extendSubscription(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, days } = req.body;
    if (!tenantId || !days) {
      res.status(400).json({ success: false, message: 'tenantId ve days gerekli.' });
      return;
    }
    const result = await adminService.extendSubscription(
      req.user!.userId, req.user!.email, tenantId, Number(days), getIp(req),
    );
    res.json({ success: true, message: `Abonelik ${days} gün uzatıldı.`, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/users ─────────────────────────────────────────────────────
export async function createUser(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { email, password, firstName, lastName, tenantId, role, plan } = req.body ?? {};
    if (!email || !password || !tenantId || !role) {
      res.status(400).json({ success: false, message: 'email, password, tenantId ve role gerekli.' });
      return;
    }
    const user = await adminService.createUserByAdmin(
      req.user!.userId,
      req.user!.email,
      {
        email,
        password,
        firstName: firstName ?? 'User',
        lastName:  lastName ?? '',
        tenantId,
        role: role as UserRole,
        plan: plan as Plan | undefined,
      },
      getIp(req),
    );
    res.status(201).json({ success: true, data: user });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────
export async function updateUser(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, role, plan, isActive } = req.body ?? {};
    const user = await adminService.updateUserByAdmin(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      {
        tenantId,
        role:     role !== undefined ? (role as UserRole) : undefined,
        plan:     plan !== undefined ? (plan as Plan) : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
      getIp(req),
    );
    res.json({ success: true, data: user });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
export async function getUsers(req: AdminRequest, res: Response): Promise<void> {
  try {
    const result = await adminService.getUsers({
      ...pagination(req),
      search:   req.query.search   as string  | undefined,
      role:     req.query.role     as string  | undefined,
      tenantId: req.query.tenantId as string  | undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error({ message: 'getUsers error', error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/user/ban ──────────────────────────────────────────────────
export async function banUser(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { userId, reason = '' } = req.body;
    if (!userId) { res.status(400).json({ success: false, message: 'userId gerekli.' }); return; }

    await adminService.banUser(req.user!.userId, req.user!.email, userId, reason, getIp(req));
    res.json({ success: true, message: 'Kullanıcı yasaklandı.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/user/unban ────────────────────────────────────────────────
export async function unbanUser(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ success: false, message: 'userId gerekli.' }); return; }

    await adminService.unbanUser(req.user!.userId, req.user!.email, userId, getIp(req));
    res.json({ success: true, message: 'Kullanıcı yasağı kaldırıldı.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/tenant/status ────────────────────────────────────────────
export async function changeTenantStatus(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, status } = req.body;
    if (!tenantId || !status) {
      res.status(400).json({ success: false, message: 'tenantId ve status gerekli.' });
      return;
    }

    await adminService.changeTenantStatus(
      req.user!.userId, req.user!.email, tenantId, status, getIp(req),
    );
    res.json({ success: true, message: `Tenant status "${status}" olarak güncellendi.` });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/billing/overview ───────────────────────────────────────────
export async function getBillingOverview(req: AdminRequest, res: Response): Promise<void> {
  try {
    const statusRaw = req.query.status as string | undefined;
    const status = statusRaw && Object.values(PaymentStatus).includes(statusRaw as PaymentStatus)
      ? (statusRaw as PaymentStatus)
      : undefined;
    const data = await adminService.getBillingOverview({
      ...pagination(req),
      status,
      tenantId: req.query.tenantId as string | undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    logger.error({ message: 'getBillingOverview error', error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/logs/activity ──────────────────────────────────────────────
export async function getLogsActivity(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getPlatformActivityLogs({
      ...pagination(req),
      tenantId: req.query.tenantId as string | undefined,
      search:   req.query.search as string | undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/logs/errors ────────────────────────────────────────────────
export async function getLogsErrors(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getPlatformErrorLogs({
      ...pagination(req),
      tenantId: req.query.tenantId as string | undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/logs/webhooks ──────────────────────────────────────────────
export async function getLogsWebhooks(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getPlatformWebhookLogs({
      ...pagination(req),
      tenantId: req.query.tenantId as string | undefined,
      success:  req.query.success as string | undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/metrics ────────────────────────────────────────────────────
export async function getMetrics(_req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getSystemMetrics();
    res.json({ success: true, data });
  } catch (err: any) {
    logger.error({ message: 'getMetrics error', error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/admin/audit-logs ─────────────────────────────────────────────────
export async function getAuditLogs(req: AdminRequest, res: Response): Promise<void> {
  try {
    const result = await adminService.getAuditLogs({
      ...pagination(req),
      search:     req.query.search     as string | undefined,
      action:     req.query.action     as string | undefined,
      category:   req.query.category   as string | undefined,
      targetType: req.query.targetType as string | undefined,
      status:     req.query.status     as string | undefined,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error({ message: 'getAuditLogs error', error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/impersonate ───────────────────────────────────────────────
export async function impersonateStart(req: AdminRequest, res: Response): Promise<void> {
  try {
    const raw = (req.body ?? {}) as { tenantId?: string | number };
    const tenantId = raw.tenantId != null ? String(raw.tenantId).trim() : '';
    if (!tenantId) {
      res.status(400).json({ success: false, message: 'tenantId gerekli.' });
      return;
    }
    const data = await adminService.startImpersonation(
      req.user!.userId,
      req.user!.email,
      tenantId,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/impersonate/stop ───────────────────────────────────────────
export async function impersonateStop(req: AdminRequest, res: Response): Promise<void> {
  try {
    if (!(req as any).isImpersonation) {
      res.status(400).json({ success: false, message: 'Aktif bir taklit oturumu yok.' });
      return;
    }
    const adminId = (req as any).impersonationAdminId as string | undefined;
    if (!adminId || !req.user?.userId) {
      res.status(400).json({ success: false, message: 'Geçersiz oturum.' });
      return;
    }
    const data = await adminService.stopImpersonation(
      req.user.userId,
      req.user.tenantId,
      adminId,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── POST /api/admin/billing/manual-payment ────────────────────────────────────
export async function recordManualPayment(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { tenantId, amount, currency, note, description, subscriptionId } = req.body ?? {};
    if (!tenantId || amount == null) {
      res.status(400).json({ success: false, message: 'tenantId ve amount gerekli.' });
      return;
    }
    const payment = await adminService.recordManualPayment(
      req.user!.userId,
      req.user!.email,
      {
        tenantId,
        amount: Number(amount),
        currency,
        note,
        description,
        subscriptionId,
      },
      getIp(req),
    );
    res.status(201).json({ success: true, data: payment });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/subscription/:tenantId ───────────────────────────────────
export async function patchSubscriptionByTenant(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { status } = req.body ?? {};
    if (!status || typeof status !== 'string') {
      res.status(400).json({ success: false, message: 'status gerekli (ACTIVE | PAUSED | CANCELLED).' });
      return;
    }
    const data = await adminService.patchSubscriptionStatusForTenant(
      req.user!.userId,
      req.user!.email,
      String(req.params.tenantId),
      status,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const statusCode = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(statusCode).json({ success: false, message: err.message });
  }
}

// ── PATCH /api/admin/billing/subscriptions/:id/status ─────────────────────────
export async function setSubscriptionStatus(req: AdminRequest, res: Response): Promise<void> {
  try {
    const { status } = req.body ?? {};
    if (status !== SubscriptionStatus.ACTIVE && status !== SubscriptionStatus.CANCELED) {
      res.status(400).json({ success: false, message: 'status yalnızca ACTIVE veya CANCELED olabilir.' });
      return;
    }
    const data = await adminService.setSubscriptionStatus(
      req.user!.userId,
      req.user!.email,
      String(req.params.id),
      status as SubscriptionStatus,
      getIp(req),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    const statusCode = err.message?.includes('bulunamadı') ? 404 : 400;
    res.status(statusCode).json({ success: false, message: err.message });
  }
}
