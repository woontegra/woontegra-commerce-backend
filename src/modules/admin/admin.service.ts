import { PrismaClient, Plan, SubscriptionStatus, BillingCycle, UserRole } from '@prisma/client';
import { logger } from '../../config/logger';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page:   number;
  limit:  number;
  search?: string;
}

export interface TenantFilters extends PaginationParams {
  status?: 'active' | 'suspended' | 'all';
  plan?:   string;
}

export interface UserFilters extends PaginationParams {
  role?:     string;
  isActive?: boolean;
  tenantId?: string;
}

// ─── AdminService ─────────────────────────────────────────────────────────────

export class AdminService {

  // ── Tenant Management ──────────────────────────────────────────────────────

  async getTenants(filters: TenantFilters) {
    const { page = 1, limit = 20, search, status = 'all', plan } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Support both legacy isActive filter and new lifecycle status filter
    if (status === 'active')    where.status = 'ACTIVE';
    if (status === 'suspended') where.status = 'SUSPENDED';
    if (status === 'trial')     where.status = 'TRIAL';
    if (status === 'past_due')  where.status = 'PAST_DUE';
    if (status === 'canceled')  where.status = 'CANCELED';

    if (search) {
      where.OR = [
        { name:      { contains: search, mode: 'insensitive' } },
        { slug:      { contains: search, mode: 'insensitive' } },
        { subdomain: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (plan) {
      where.users = { some: { plan: plan as Plan, role: UserRole.ADMIN } };
    }

    const [tenants, total] = await prisma.$transaction([
      prisma.tenant.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count:        { select: { users: true, products: true, orders: true } },
          subscriptions: {
            where:   { status: SubscriptionStatus.ACTIVE, endDate: { gte: new Date() } },
            orderBy: { createdAt: 'desc' },
            take:    1,
          },
          users: {
            where:  { role: UserRole.ADMIN },
            select: { email: true, firstName: true, lastName: true, plan: true },
            take:   1,
          },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    return { tenants, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenantById(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where:   { id: tenantId },
      include: {
        users: {
          select: {
            id: true, email: true, firstName: true, lastName: true,
            role: true, isActive: true, plan: true, createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take:    5,
          include: { payments: { orderBy: { createdAt: 'desc' }, take: 3 } },
        },
        settings:  true,
        _count: {
          select: {
            products: true, orders: true, customers: true,
            coupons:  true, posts: true,
          },
        },
      },
    });

    if (!tenant) throw new Error('Tenant bulunamadı.');

    // Revenue: sum of successful payments for this tenant
    const revenue = await prisma.payment.aggregate({
      where: { tenantId, status: 'SUCCESS' },
      _sum:  { amount: true },
    });

    return { ...tenant, totalRevenue: revenue._sum.amount ?? 0 };
  }

  async suspendTenant(adminId: string, adminEmail: string, tenantId: string, reason: string, ip?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: false, status: 'SUSPENDED', suspendedAt: new Date() },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_SUSPENDED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      details: { reason }, ipAddress: ip,
    });

    logger.info({ message: 'Tenant suspended', tenantId, adminId, reason });
  }

  async activateTenant(adminId: string, adminEmail: string, tenantId: string, ip?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: true, status: 'ACTIVE', suspendedAt: null },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_ACTIVATED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      ipAddress: ip,
    });

    logger.info({ message: 'Tenant activated', tenantId, adminId });
  }

  async changeTenantStatus(
    adminId:    string,
    adminEmail: string,
    tenantId:   string,
    status:     'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED',
    ip?:        string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    const VALID = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'];
    if (!VALID.includes(status)) throw new Error('Geçersiz status değeri.');

    const updateData: Record<string, unknown> = { status };
    if (status === 'SUSPENDED') {
      updateData.suspendedAt = new Date();
      updateData.isActive    = false;
    } else if (status === 'ACTIVE') {
      updateData.suspendedAt = null;
      updateData.isActive    = true;
    } else if (status === 'CANCELED') {
      updateData.isActive = false;
    }

    await prisma.tenant.update({ where: { id: tenantId }, data: updateData });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_STATUS_CHANGED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      details: { previousStatus: (tenant as any).status, newStatus: status }, ipAddress: ip,
    });

    logger.info({ message: 'Tenant status changed', tenantId, adminId, status });
  }

  async deleteTenant(adminId: string, adminEmail: string, tenantId: string, ip?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    await prisma.tenant.delete({ where: { id: tenantId } });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_DELETED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      ipAddress: ip,
    });

    logger.warn({ message: 'Tenant deleted', tenantId, adminId });
  }

  // ── Extend Subscription ────────────────────────────────────────────────────

  async extendSubscription(
    adminId:    string,
    adminEmail: string,
    tenantId:   string,
    days:       number,
    ip?:        string,
  ) {
    if (!days || days < 1 || days > 3650) throw new Error('Geçersiz gün sayısı (1–3650).');

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    // Find the latest active subscription (or most recent one)
    const sub = await prisma.subscription.findFirst({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new Error('Bu tenant için abonelik bulunamadı.');

    const currentEnd   = sub.endDate ?? new Date();
    const baseDate     = currentEnd > new Date() ? currentEnd : new Date();
    const newEndDate   = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data:  {
        endDate: newEndDate,
        status:  SubscriptionStatus.ACTIVE,
      },
    });

    // Make sure tenant is active after extension
    await prisma.tenant.update({
      where: { id: tenantId },
      data:  { isActive: true, status: 'ACTIVE', suspendedAt: null },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_PLAN_CHANGED, category: AuditCategory.BILLING,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      details: { action: 'extend_subscription', days, previousEndDate: sub.endDate, newEndDate },
      ipAddress: ip,
    });

    logger.info({ message: 'Subscription extended', tenantId, days, adminId });
    return { subscription: updated, newEndDate };
  }

  // ── Subscription Override ──────────────────────────────────────────────────

  async overrideSubscription(
    adminId:     string,
    adminEmail:  string,
    tenantId:    string,
    plan:        Plan,
    billingCycle: BillingCycle,
    endDate:     Date,
    ip?:         string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    // Find the admin user of this tenant
    const adminUser = await prisma.user.findFirst({
      where: { tenantId, role: UserRole.ADMIN },
    });
    if (!adminUser) throw new Error('Tenant admin kullanıcısı bulunamadı.');

    // Cancel existing active subscriptions
    await prisma.subscription.updateMany({
      where: { tenantId, status: SubscriptionStatus.ACTIVE },
      data:  { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });

    // Create new manual subscription
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        userId:      adminUser.id,
        plan,
        billingCycle,
        status:    SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        endDate,
      },
    });

    // Sync User.plan for all users in tenant
    await prisma.user.updateMany({
      where: { tenantId },
      data:  { plan },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_PLAN_CHANGED, category: AuditCategory.BILLING,
      targetType: 'Tenant', targetId: tenantId, targetName: tenant.name,
      details: { plan, billingCycle, endDate: endDate.toISOString(), subscriptionId: subscription.id },
      ipAddress: ip,
    });

    logger.info({ message: 'Subscription overridden', tenantId, plan, adminId });
    return subscription;
  }

  // ── User Management ────────────────────────────────────────────────────────

  async getUsers(filters: UserFilters) {
    const { page = 1, limit = 30, search, role, isActive, tenantId } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role)     where.role     = role;
    if (tenantId) where.tenantId = tenantId;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    if (search) {
      where.OR = [
        { email:     { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, isActive: true, plan: true, createdAt: true,
          tenant: { select: { id: true, name: true, slug: true, isActive: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async banUser(adminId: string, adminEmail: string, userId: string, reason: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (!user.isActive) throw new Error('Kullanıcı zaten banlanmış.');

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.USER_BANNED, category: AuditCategory.USER,
      targetType: 'User', targetId: userId,
      targetName: `${user.firstName} ${user.lastName} <${user.email}>`,
      details: { reason }, ipAddress: ip,
    });
  }

  async unbanUser(adminId: string, adminEmail: string, userId: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (user.isActive) throw new Error('Kullanıcı zaten aktif.');

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.USER_UNBANNED, category: AuditCategory.USER,
      targetType: 'User', targetId: userId,
      targetName: `${user.firstName} ${user.lastName} <${user.email}>`,
      ipAddress: ip,
    });
  }

  // ── System Metrics ─────────────────────────────────────────────────────────

  async getSystemMetrics() {
    const now        = new Date();
    const thirtyAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenAgo   = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);

    // ── Month boundaries ──────────────────────────────────────────────────────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // ── Last month boundaries ─────────────────────────────────────────────────
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalTenants,
      activeTenants,
      trialTenants,
      pastDueTenants,
      suspendedTenants,
      canceledTenants,
      totalUsers,
      // ── Invoice-based revenue (primary accounting source) ──────────────────
      invoiceTotalRevenue,
      invoiceMonthlyRevenue,
      invoiceLastMonthRevenue,
      // ── Payment-based revenue (legacy / fallback for un-invoiced payments) ─
      paymentTotalRevenue,
      paymentMonthlyRevenue,
      // ── Subscription counts ────────────────────────────────────────────────
      activeSubscriptions,
      expiredSubscriptions,
      trialSubscriptions,
      pastDueSubscriptions,
      newTenantsThisMonth,
      newTenantsThisWeek,
      planCounts,
      recentInvoices,
    ] = await prisma.$transaction([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: 'ACTIVE'    } }),
      prisma.tenant.count({ where: { status: 'TRIAL'     } }),
      prisma.tenant.count({ where: { status: 'PAST_DUE'  } }),
      prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      prisma.tenant.count({ where: { status: 'CANCELED'  } }),
      prisma.user.count(),

      // Invoice total (all time)
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _sum:  { total: true },
      }),
      // Invoice total (current month) — use paidAt for accurate month bucketing
      prisma.invoice.aggregate({
        where: { status: 'PAID', paidAt: { gte: monthStart, lte: monthEnd } },
        _sum:  { total: true },
      }),
      // Invoice total (last month) for MoM comparison
      prisma.invoice.aggregate({
        where: { status: 'PAID', paidAt: { gte: lastMonthStart, lte: lastMonthEnd } },
        _sum:  { total: true },
      }),

      // Payment totals (kept for backward compat / un-invoiced payments)
      prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum:  { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: monthStart, lte: monthEnd } },
        _sum:  { amount: true },
      }),

      // Active subscriptions with future endDate
      prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE, endDate: { gte: now } },
      }),
      // De-facto expired (active status but endDate passed)
      prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE, endDate: { lt: now } },
      }),
      // Pending / trial subscriptions
      prisma.subscription.count({
        where: { status: SubscriptionStatus.PENDING },
      }),
      prisma.subscription.count({
        where: { status: SubscriptionStatus.PAST_DUE },
      }),
      prisma.tenant.count({ where: { createdAt: { gte: thirtyAgo } } }),
      prisma.tenant.count({ where: { createdAt: { gte: sevenAgo  } } }),
      // Plan distribution from active subscriptions
      prisma.subscription.groupBy({
        by:     ['plan'],
        _count: true,
        where:  { status: SubscriptionStatus.ACTIVE, endDate: { gte: now } },
      }),
      // Recent paid invoices (richer than raw payments)
      prisma.invoice.findMany({
        where:   { status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take:    10,
        select: {
          id: true, number: true, total: true, currency: true,
          paidAt: true, type: true,
          subscription: { select: { plan: true } },
          tenant: { select: { name: true } },
        },
      }),
    ]);

    // ── Combine revenue: Invoice is authoritative; supplement with un-invoiced payments ──
    const invoiceTotal    = Number(invoiceTotalRevenue._sum.total    ?? 0);
    const invoiceMonthly  = Number(invoiceMonthlyRevenue._sum.total  ?? 0);
    const invoiceLastMonth = Number(invoiceLastMonthRevenue._sum.total ?? 0);
    const paymentTotal    = Number(paymentTotalRevenue._sum.amount   ?? 0);
    const paymentMonthly  = Number(paymentMonthlyRevenue._sum.amount ?? 0);

    // Use invoice when available; if no invoices at all fall back to payment data
    const hasInvoiceData  = invoiceTotal > 0;
    const totalRevenue    = hasInvoiceData ? invoiceTotal   : paymentTotal;
    const monthlyRevenue  = hasInvoiceData ? invoiceMonthly : paymentMonthly;
    const lastMonthRevenue = invoiceLastMonth;

    // Month-over-month growth %
    const momGrowth = lastMonthRevenue > 0
      ? Math.round(((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : null;

    return {
      tenants: {
        total:        totalTenants,
        active:       activeTenants,
        trial:        trialTenants,
        pastDue:      pastDueTenants,
        suspended:    suspendedTenants,
        canceled:     canceledTenants,
        newThisMonth: newTenantsThisMonth,
        newThisWeek:  newTenantsThisWeek,
      },
      users: { total: totalUsers },
      revenue: {
        total:        totalRevenue,
        monthly:      monthlyRevenue,
        lastMonth:    lastMonthRevenue,
        momGrowth,              // month-over-month % change (null when no last-month data)
        fromInvoices: invoiceTotal,
        fromPayments: paymentTotal,
      },
      subscriptions: {
        active:   activeSubscriptions,
        expired:  expiredSubscriptions,
        trial:    trialTenants,           // mirror from tenant status
        pastDue:  pastDueSubscriptions,
        pending:  trialSubscriptions,
        byPlan:   planCounts.reduce(
          (acc, r) => ({ ...acc, [r.plan]: r._count }),
          {} as Record<string, number>,
        ),
      },
      recentInvoices: recentInvoices.map(inv => ({
        id:         inv.id,
        number:     inv.number,
        amount:     Number(inv.total),
        currency:   inv.currency,
        paidAt:     inv.paidAt,
        type:       inv.type,
        plan:       inv.subscription?.plan ?? null,
        tenantName: inv.tenant?.name ?? null,
      })),
    };
  }

  // ── Audit Logs ─────────────────────────────────────────────────────────────

  async getAuditLogs(filters: PaginationParams & {
    action?: string; category?: string; targetType?: string; status?: string;
  }) {
    const result = await auditService.getLogs({
      page:       filters.page,
      limit:      filters.limit,
      search:     filters.search,
      action:     filters.action,
      category:   filters.category,
      targetType: filters.targetType,
      status:     filters.status,
    });
    return {
      logs:       result.items,
      total:      result.total,
      page:       result.page,
      limit:      result.limit,
      totalPages: Math.ceil(result.total / result.limit),
    };
  }
}
