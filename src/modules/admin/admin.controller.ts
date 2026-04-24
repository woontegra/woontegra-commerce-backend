import { Request, Response } from 'express';
import { BillingCycle, Plan } from '@prisma/client';
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

// ── GET /api/admin/tenants/:id ────────────────────────────────────────────────
export async function getTenantById(req: AdminRequest, res: Response): Promise<void> {
  try {
    const data = await adminService.getTenantById(req.params.id);
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
    await adminService.deleteTenant(req.user!.userId, req.user!.email, req.params.id, getIp(req));
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
