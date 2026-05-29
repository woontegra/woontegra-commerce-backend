import {
  PrismaClient,
  Plan,
  Prisma,
  SubscriptionStatus,
  BillingCycle,
  UserRole,
  LogType,
  LogLevel,
  PaymentStatus,
  TenantUsageAction,
} from '@prisma/client';
import { logger } from '../../config/logger';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';
import { hashPassword } from '../../common/utils/password.util';
import { generateToken } from '../../common/utils/jwt.util';
import { generateRefreshToken } from '../../common/middleware/authEnhanced';
import {
  getEffectivePlanForTenant,
  getProductQuotaForTenant,
  getTenantPlanLimit,
} from '../../services/planQuota.service';
import { PLAN_NAMES } from '../../config/plans';
import { getTenantUsageSummary, logTenantUsage } from '../../services/tenantUsageLog.service';
import { syncTenantDomainsFromTenant } from '../../services/tenantDomainSync.service';
import { verifyCustomDomainDns } from '../../services/tenantDomainDns.service';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page:   number;
  limit:  number;
  search?: string;
}

export interface TenantFilters extends PaginationParams {
  status?: 'active' | 'suspended' | 'trial' | 'past_due' | 'canceled' | 'all';
  plan?:   string;
}

export interface UserFilters extends PaginationParams {
  role?:     string;
  isActive?: boolean;
  tenantId?: string;
}

const ASSIGNABLE_USER_ROLES: UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.STAFF,
  UserRole.USER,
];

type InitialTenantPlan = 'TRIAL' | Plan;

function parseInitialTenantPlan(value: unknown): InitialTenantPlan {
  if (value === undefined || value === null || value === '') return 'TRIAL';
  const raw = String(value).trim().toUpperCase();
  if (raw === 'TRIAL' || raw === 'DEMO') return 'TRIAL';
  if (raw === 'PROFESSIONAL') return Plan.PRO;
  if (Object.values(Plan).includes(raw as Plan)) return raw as Plan;
  throw new Error('Geçersiz plan. TRIAL, STARTER, PRO veya ENTERPRISE kullanın.');
}

function defaultPaidSubscriptionEndDate(billingCycle: BillingCycle): Date {
  const end = new Date();
  if (billingCycle === BillingCycle.YEARLY) {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
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
      where.users = {
        some: {
          plan: plan as Plan,
          role: { in: [UserRole.ADMIN, UserRole.OWNER] },
        },
      };
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
            role: true, isActive: true, plan: true, createdAt: true, lastLoginAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take:    5,
          include: { payments: { orderBy: { createdAt: 'desc' }, take: 3 } },
        },
        settings:     true,
        tenantDomains: { orderBy: { createdAt: 'asc' } },
        _count: {
          select: {
            products: true, orders: true, customers: true,
            coupons:  true, posts: true,
          },
        },
      },
    });

    if (!tenant) throw new Error('Tenant bulunamadı.');

    const revenue = await prisma.payment.aggregate({
      where: { tenantId, status: 'SUCCESS' },
      _sum:  { amount: true },
    });

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      productQuota,
      activeUserCount,
      userLastLoginAgg,
      loginCount30d,
      productCreates30d,
      lastAuditActivity,
    ] = await Promise.all([
      getProductQuotaForTenant(tenantId),
      prisma.user.count({ where: { tenantId, isActive: true } }),
      prisma.user.aggregate({
        where: { tenantId },
        _max:  { lastLoginAt: true },
      }),
      prisma.auditLog.count({
        where: {
          tenantId,
          action:    'LOGIN',
          createdAt: { gte: since30 },
        },
      }),
      prisma.auditLog.count({
        where: {
          tenantId,
          action:    AuditAction.PRODUCT_CREATED,
          createdAt: { gte: since30 },
        },
      }),
      prisma.auditLog.aggregate({
        where: {
          tenantId,
          action: { in: ['LOGIN', AuditAction.PRODUCT_CREATED] },
        },
        _max: { createdAt: true },
      }),
    ]);

    const lastUserLogin = userLastLoginAgg._max.lastLoginAt;
    const lastAuditAt   = lastAuditActivity._max.createdAt;
    const lastActivityAt =
      !lastUserLogin && !lastAuditAt
        ? null
        : !lastUserLogin
          ? lastAuditAt
          : !lastAuditAt
            ? lastUserLogin
            : lastUserLogin > lastAuditAt
              ? lastUserLogin
              : lastAuditAt;

    const effectivePlan = await getEffectivePlanForTenant(tenantId);

    return {
      ...tenant,
      totalRevenue: revenue._sum.amount ?? 0,
      effectivePlan,
      productQuota,
      activeUserCount,
      lastUserLoginAt: lastUserLogin,
      usage: {
        loginsLast30Days:       loginCount30d,
        productsCreatedLast30d: productCreates30d,
        lastActivityAt:         lastActivityAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Özet kartları için hafif payload (GET /api/admin/tenants/:id/detail).
   */
  async getTenantDetailForAdmin(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id:               true,
        name:             true,
        slug:             true,
        isActive:         true,
        createdAt:        true,
        subdomain:        true,
        customDomain:     true,
        domainVerified:   true,
        status:           true,
        trialEndsAt:      true,
      },
    });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    const [productCount, planLim, activeUsers, lastLoginAgg, activeSub] = await Promise.all([
      prisma.product.count({ where: { tenantId } }),
      getTenantPlanLimit(tenantId),
      prisma.user.count({ where: { tenantId, isActive: true } }),
      prisma.user.aggregate({
        where: { tenantId },
        _max:  { lastLoginAt: true },
      }),
      prisma.subscription.findFirst({
        where:   { tenantId, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        select:  { endDate: true, plan: true },
      }),
    ]);

    const billingPlan = activeSub?.plan ?? planLim.plan;
    const planLabel   = (PLAN_NAMES as Record<string, string>)[billingPlan] ?? String(billingPlan);

    return {
      tenant,
      stats: {
        productCount,
        productLimit: planLim.unlimited ? null : planLim.maxProducts,
        activeUsers,
        lastLoginAt: lastLoginAgg._max.lastLoginAt ?? null,
        createdAt:   tenant.createdAt,
      },
      plan: {
        name:      planLabel,
        expiresAt: activeSub?.endDate ?? null,
      },
    };
  }

  /** GET /api/admin/tenants/:id/usage — tenant_usage_logs özetleri (tek SQL). */
  async getTenantUsageForAdmin(tenantId: string) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new Error('Tenant bulunamadı.');
    return getTenantUsageSummary(tenantId);
  }

  /**
   * Start tenant impersonation (caller must be SUPER_ADMIN — enforced in controller).
   * @param tenantId UUID string (JSON may send number in broken clients; coerced to string)
   */
  async startImpersonation(adminId: string, adminEmail: string, tenantId: string, ip?: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          where: { isActive: true, role: { in: [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF] } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!tenant) throw new Error('Tenant bulunamadı.');
    if (!tenant.isActive) throw new Error('Tenant aktif değil; kimliğe bürünme yapılamaz.');

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true, isActive: true },
    });
    if (!admin?.isActive || String(admin.role).toUpperCase() !== 'SUPER_ADMIN') {
      throw new Error('Yalnızca SUPER_ADMIN kullanıcıları tenant taklidi başlatabilir.');
    }

    const target =
      tenant.users.find((u) => u.role === UserRole.OWNER)
      ?? tenant.users.find((u) => u.role === UserRole.ADMIN)
      ?? tenant.users[0];

    if (!target) throw new Error('Bu tenant için uygun aktif kullanıcı bulunamadı.');

    const token = generateToken(
      {
        userId:          target.id,
        tenantId:        target.tenantId,
        email:           target.email,
        role:            target.role,
        isImpersonation: true,
        adminId,
      },
      { expiresIn: '2h' },
    );

    const refreshToken = generateRefreshToken(target.id);

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      tenantId,
      action: AuditAction.IMPERSONATION_STARTED, category: AuditCategory.TENANT,
      targetType: 'User', targetId: target.id,
      targetName: `${target.firstName} ${target.lastName} <${target.email}>`,
      details: { tenantId, tenantName: tenant.name, impersonatedUserId: target.id },
      ipAddress: ip,
    });

    logTenantUsage(tenantId, TenantUsageAction.LOGIN);

    return {
      token,
      refreshToken,
      tenantId:      target.tenantId,
      impersonating: true as const,
      tenantName:    tenant.name,
      user: {
        id:        target.id,
        email:     target.email,
        firstName: target.firstName,
        lastName:  target.lastName,
        role:      target.role,
        tenantId:  target.tenantId,
      },
    };
  }

  async stopImpersonation(
    tenantUserId: string,
    tenantId: string,
    adminIdFromJwt: string,
    ip?: string,
  ) {
    const admin = await prisma.user.findUnique({
      where: { id: adminIdFromJwt },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        tenantId: true, isActive: true,
      },
    });
    if (!admin?.isActive || String(admin.role).toUpperCase() !== 'SUPER_ADMIN') {
      throw new Error('Geçersiz yönetici oturumu.');
    }

    await auditService.log({
      userId: admin.id, userEmail: admin.email, userRole: 'SUPER_ADMIN',
      tenantId,
      action: AuditAction.IMPERSONATION_ENDED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId,
      details: { endedAsUserId: tenantUserId },
      ipAddress: ip,
    });

    const token = generateToken({
      userId:   admin.id,
      tenantId: admin.tenantId,
      email:    admin.email,
      role:     admin.role,
    });
    const refreshToken = generateRefreshToken(admin.id);

    return {
      token,
      refreshToken,
      tenantId:      admin.tenantId,
      impersonating: false as const,
      user: {
        id:        admin.id,
        email:     admin.email,
        firstName: admin.firstName,
        lastName:  admin.lastName,
        role:      admin.role,
        tenantId:  admin.tenantId,
      },
    };
  }

  async recordManualPayment(
    adminId: string,
    adminEmail: string,
    input: {
      tenantId: string;
      amount:   number;
      currency?: string;
      /** @deprecated use description */
      note?: string;
      description?: string;
      subscriptionId?: string;
    },
    ip?: string,
  ) {
    const { tenantId, amount, currency = 'TRY', note, description, subscriptionId } = input;
    const narrative = (description ?? note ?? '').trim();
    if (!tenantId || amount == null || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error('tenantId ve pozitif amount gerekli.');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    let sub = subscriptionId
      ? await prisma.subscription.findFirst({ where: { id: subscriptionId, tenantId } })
      : await prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });

    const billingUser = await prisma.user.findFirst({
      where: { tenantId, role: { in: [UserRole.OWNER, UserRole.ADMIN] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!billingUser) throw new Error('Tenant için kullanıcı bulunamadı.');

    if (!sub) {
      sub = await prisma.subscription.create({
        data: {
          tenantId,
          userId:       billingUser.id,
          plan:         billingUser.plan,
          billingCycle: BillingCycle.MONTHLY,
          status:       SubscriptionStatus.ACTIVE,
          startDate:    new Date(),
          endDate:      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }

    const payment = await prisma.payment.create({
      data: {
        tenantId,
        subscriptionId: sub.id,
        userId:         billingUser.id,
        amount:         new Prisma.Decimal(String(amount)),
        currency,
        status:         PaymentStatus.SUCCESS,
        provider:       'manual',
        metadata:       {
          note: narrative,
          description: narrative,
          createdByAdminId: adminId,
          createdByAdminEmail: adminEmail,
        },
      },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      tenantId,
      action: AuditAction.PAYMENT_SUCCESS, category: AuditCategory.BILLING,
      targetType: 'Payment', targetId: payment.id,
      details: { manual: true, amount, currency, subscriptionId: sub.id, description: narrative },
      ipAddress: ip,
    });

    return payment;
  }

  async setSubscriptionStatus(
    adminId: string,
    adminEmail: string,
    subscriptionId: string,
    status: SubscriptionStatus,
    ip?: string,
  ) {
    const allowed: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED];
    if (!allowed.includes(status)) {
      throw new Error('Yalnızca ACTIVE veya CANCELED kullanılabilir.');
    }

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { tenant: true },
    });
    if (!sub) throw new Error('Abonelik bulunamadı.');

    const prev = sub.status;
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status,
        ...(status === SubscriptionStatus.CANCELED
          ? { canceledAt: new Date() }
          : { canceledAt: null }),
      },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      tenantId: sub.tenantId,
      action: status === SubscriptionStatus.CANCELED
        ? AuditAction.SUBSCRIPTION_CANCELED
        : AuditAction.SUBSCRIPTION_ACTIVATED,
      category: AuditCategory.BILLING,
      targetType: 'Subscription', targetId: subscriptionId,
      targetName: sub.tenant.name,
      details: { previousStatus: prev, newStatus: status },
      ipAddress: ip,
    });

    return { id: subscriptionId, status };
  }

  /**
   * PATCH /api/admin/subscription/:tenantId — son abonelik kaydının durumu.
   * API: ACTIVE | PAUSED | CANCELLED → Prisma: ACTIVE | PAST_DUE | CANCELED
   */
  async patchSubscriptionStatusForTenant(
    adminId: string,
    adminEmail: string,
    tenantId: string,
    apiStatus: string,
    ip?: string,
  ) {
    const norm = String(apiStatus).toUpperCase();
    const alias: Record<string, SubscriptionStatus> = {
      ACTIVE:     SubscriptionStatus.ACTIVE,
      PAUSED:     SubscriptionStatus.PAST_DUE,
      CANCELLED:  SubscriptionStatus.CANCELED,
      CANCELED:   SubscriptionStatus.CANCELED,
    };
    const status = alias[norm];
    if (!status) {
      throw new Error('Geçersiz status. ACTIVE, PAUSED veya CANCELLED olmalı.');
    }

    const sub = await prisma.subscription.findFirst({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { tenant: true },
    });
    if (!sub) throw new Error('Bu tenant için abonelik bulunamadı.');

    const prev = sub.status;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status,
        ...(status === SubscriptionStatus.CANCELED
          ? { canceledAt: new Date() }
          : { canceledAt: null }),
      },
    });

    const action =
      status === SubscriptionStatus.CANCELED ? AuditAction.SUBSCRIPTION_CANCELED
        : status === SubscriptionStatus.ACTIVE ? AuditAction.SUBSCRIPTION_ACTIVATED
          : AuditAction.CONFIG_CHANGED;

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      tenantId,
      action,
      category: AuditCategory.BILLING,
      targetType: 'Subscription', targetId: sub.id,
      targetName: sub.tenant.name,
      details: {
        previousStatus: prev,
        newStatus:      status,
        requestedLabel: norm,
        path:           'PATCH /admin/subscription/:tenantId',
      },
      ipAddress: ip,
    });

    return {
      subscriptionId: sub.id,
      tenantId,
      status,
      requested: norm,
    };
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

  /** PATCH /api/admin/tenants/:id/status — çok kiracılı ortamda yalnızca hedef tenant güncellenir. */
  async patchTenantActive(
    adminId: string,
    adminEmail: string,
    tenantId: string,
    isActive: boolean,
    ip?: string,
  ) {
    if (isActive) {
      await this.activateTenant(adminId, adminEmail, tenantId, ip);
    } else {
      await this.suspendTenant(adminId, adminEmail, tenantId, 'Admin panel: mağaza pasifleştirildi', ip);
    }
    const row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, name: true, isActive: true, status: true, suspendedAt: true,
      },
    });
    if (!row) throw new Error('Tenant bulunamadı.');
    return row;
  }

  /** PATCH /api/admin/users/:id/status */
  async patchUserActive(adminId: string, adminEmail: string, userId: string, isActive: boolean, ip?: string) {
    await this.updateUserByAdmin(adminId, adminEmail, userId, { isActive }, ip);
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:         true,
        email:      true,
        firstName:  true,
        lastName:   true,
        role:       true,
        isActive:   true,
        plan:       true,
        createdAt:  true,
        tenantId:   true,
        tenant:     { select: { id: true, name: true, slug: true, isActive: true } },
      },
    });
    if (!row) throw new Error('Kullanıcı bulunamadı.');
    return row;
  }

  /** PATCH /api/admin/users/:id/plan — tenant kullanıcısı planı (abonelik değil, User.plan). */
  async patchUserPlan(adminId: string, adminEmail: string, userId: string, plan: Plan, ip?: string) {
    const allowed: Plan[] = [Plan.STARTER, Plan.PRO, Plan.ENTERPRISE];
    if (!allowed.includes(plan)) throw new Error('Geçersiz plan. STARTER, PRO veya ENTERPRISE olmalı.');
    await this.updateUserByAdmin(adminId, adminEmail, userId, { plan }, ip);
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:         true,
        email:      true,
        firstName:  true,
        lastName:   true,
        role:       true,
        isActive:   true,
        plan:       true,
        createdAt:  true,
        tenantId:   true,
        tenant:     { select: { id: true, name: true, slug: true, isActive: true } },
      },
    });
    if (!row) throw new Error('Kullanıcı bulunamadı.');
    return row;
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

    const adminUser = await prisma.user.findFirst({
      where: { tenantId, role: { in: [UserRole.OWNER, UserRole.ADMIN] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) throw new Error('Tenant için OWNER veya ADMIN kullanıcı bulunamadı.');

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

    const [totalProducts, activeUsers] = await Promise.all([
      prisma.product.count(),
      prisma.user.count({ where: { isActive: true } }),
    ]);

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
      users:   { total: totalUsers, active: activeUsers },
      products: { total: totalProducts },
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

  // ── Tenant create & domains ─────────────────────────────────────────────────

  private slugifyTenantKey(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tenant';
    return base;
  }

  private async ensureUniqueSlug(preferred: string): Promise<string> {
    let slug = preferred;
    let n = 0;
    while (await prisma.tenant.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${preferred}-${n}`;
    }
    return slug;
  }

  async createTenant(
    adminId: string,
    adminEmail: string,
    input: {
      name: string;
      slug?: string;
      subdomain?: string | null;
      customDomain?: string | null;
      domainVerified?: boolean;
      /** TRIAL (varsayılan) veya STARTER | PRO | ENTERPRISE */
      initialPlan?: InitialTenantPlan | string;
      billingCycle?: BillingCycle;
      subscriptionEndDate?: string;
      owner?: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        role?: UserRole;
      };
    },
    ip?: string,
  ) {
    const name = input.name?.trim();
    if (!name) throw new Error('Tenant adı gerekli.');

    const initialPlan = parseInitialTenantPlan(input.initialPlan);
    const isTrial     = initialPlan === 'TRIAL';

    if (!isTrial && !(input.owner?.email && input.owner.password)) {
      throw new Error('Ücretli plan için ilk kullanıcı (owner/admin) zorunludur.');
    }

    let billingCycle = input.billingCycle ?? BillingCycle.MONTHLY;
    if (!Object.values(BillingCycle).includes(billingCycle)) {
      throw new Error('Geçersiz billingCycle.');
    }

    let subscriptionEndDate: Date | null = null;
    if (!isTrial) {
      if (input.subscriptionEndDate) {
        subscriptionEndDate = new Date(input.subscriptionEndDate);
        if (Number.isNaN(subscriptionEndDate.getTime())) {
          throw new Error('Geçersiz subscriptionEndDate.');
        }
      } else {
        subscriptionEndDate = defaultPaidSubscriptionEndDate(billingCycle);
      }
    }

    const baseSlug = this.slugifyTenantKey(input.slug?.trim() || name);
    const slug       = await this.ensureUniqueSlug(baseSlug);

    let subdomain = input.subdomain?.trim().toLowerCase() || null;
    if (subdomain) {
      if (!/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(subdomain) || subdomain.length > 63) {
        throw new Error('Geçersiz subdomain (yalnızca küçük harf, rakam ve tire; max 63).');
      }
      const sBusy = await prisma.tenant.findFirst({ where: { subdomain } });
      if (sBusy) throw new Error('Bu subdomain başka bir tenant tarafından kullanılıyor.');
    }

    let customDomain = input.customDomain?.trim().toLowerCase() || null;
    if (customDomain) {
      const dBusy = await prisma.tenant.findFirst({ where: { customDomain } });
      if (dBusy) throw new Error('Bu özel domain zaten kayıtlı.');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const paidPlan = isTrial ? null : (initialPlan as Plan);
    const ownerPlan = paidPlan ?? Plan.STARTER;

    const tenant = await prisma.$transaction(async tx => {
      const t = await tx.tenant.create({
        data: {
          name,
          slug,
          subdomain,
          customDomain,
          domainVerified: input.domainVerified ?? false,
          isActive:         true,
          status:           isTrial ? 'TRIAL' : 'ACTIVE',
          trialEndsAt:      isTrial ? trialEndsAt : null,
        },
      });

      let ownerUserId: string | null = null;

      if (input.owner?.email && input.owner.password) {
        const email = input.owner.email.trim().toLowerCase();
        const exists = await tx.user.findFirst({ where: { email, tenantId: t.id } });
        if (exists) throw new Error('Bu e-posta bu tenant için zaten kayıtlı.');

        const role = input.owner.role ?? UserRole.ADMIN;
        if (!ASSIGNABLE_USER_ROLES.includes(role)) throw new Error('Geçersiz kullanıcı rolü.');

        const hashed = await hashPassword(input.owner.password);
        const ownerUser = await tx.user.create({
          data: {
            email,
            password:  hashed,
            firstName: input.owner.firstName?.trim() || 'Admin',
            lastName:  input.owner.lastName?.trim() || 'User',
            role:      role as UserRole,
            tenantId:  t.id,
            plan:      ownerPlan,
            isActive:  true,
          },
        });
        ownerUserId = ownerUser.id;
      }

      if (paidPlan && ownerUserId && subscriptionEndDate) {
        await tx.subscription.create({
          data: {
            tenantId:     t.id,
            userId:         ownerUserId,
            plan:           paidPlan,
            billingCycle,
            status:         SubscriptionStatus.ACTIVE,
            startDate:      new Date(),
            endDate:        subscriptionEndDate,
          },
        });
      }

      return t;
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_CREATED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenant.id, targetName: tenant.name,
      details: {
        slug, subdomain, customDomain, hasOwner: !!input.owner,
        initialPlan, billingCycle: isTrial ? null : billingCycle,
        subscriptionEndDate: subscriptionEndDate?.toISOString() ?? null,
      },
      ipAddress: ip,
    });

    await syncTenantDomainsFromTenant({
      id:               tenant.id,
      subdomain:        tenant.subdomain,
      customDomain:     tenant.customDomain,
      domainVerified:   tenant.domainVerified,
    });

    logger.info({ message: 'Tenant created by admin', tenantId: tenant.id, adminId });
    return this.getTenantById(tenant.id);
  }

  async updateTenantDomains(
    adminId: string,
    adminEmail: string,
    tenantId: string,
    input: { subdomain?: string | null; customDomain?: string | null; domainVerified?: boolean },
    ip?: string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    const data: Record<string, unknown> = {};
    if (input.subdomain !== undefined) {
      const sub = typeof input.subdomain === 'string' ? input.subdomain.trim().toLowerCase() : null;
      if (sub) {
        if (!/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(sub) || sub.length > 63) {
          throw new Error('Geçersiz subdomain.');
        }
        const busy = await prisma.tenant.findFirst({ where: { subdomain: sub, NOT: { id: tenantId } } });
        if (busy) throw new Error('Subdomain kullanımda.');
      }
      data.subdomain = sub;
    }
    if (input.customDomain !== undefined) {
      const dom = typeof input.customDomain === 'string' ? input.customDomain.trim().toLowerCase() : null;
      if (dom) {
        const busy = await prisma.tenant.findFirst({ where: { customDomain: dom, NOT: { id: tenantId } } });
        if (busy) throw new Error('Özel domain kullanımda.');
      }
      data.customDomain = dom;
    }
    if (typeof input.domainVerified === 'boolean') {
      data.domainVerified = input.domainVerified;
    }

    const updated = await prisma.tenant.update({ where: { id: tenantId }, data: data as any });

    await syncTenantDomainsFromTenant({
      id:               updated.id,
      subdomain:        updated.subdomain,
      customDomain:     updated.customDomain,
      domainVerified:   updated.domainVerified,
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_DOMAIN_UPDATED, category: AuditCategory.TENANT,
      targetType: 'Tenant', targetId: tenantId, targetName: updated.name,
      details: input,
      ipAddress: ip,
    });

    return updated;
  }

  /** POST /api/admin/tenants/:id/domains/verify — DNS ile custom domain doğrula. */
  async verifyTenantDomain(
    adminId: string,
    adminEmail: string,
    tenantId: string,
    input: { domainId: string },
    ip?: string,
  ) {
    const domainId = input.domainId?.trim();
    if (!domainId) throw new Error('domainId gerekli.');

    const row = await prisma.tenantDomain.findFirst({
      where:   { id: domainId, tenantId },
      include: { tenant: true },
    });
    if (!row) throw new Error('Domain kaydı bulunamadı.');

    if (row.type === 'subdomain') {
      await prisma.tenantDomain.update({
        where: { id: row.id },
        data:  { isVerified: true },
      });
    } else {
      const dns = await verifyCustomDomainDns(row.domain);
      if (!dns.ok) throw new Error(dns.detail);

      await prisma.tenantDomain.update({
        where: { id: row.id },
        data:  { isVerified: true },
      });

      const tCustom = row.tenant.customDomain?.trim().toLowerCase() || null;
      if (tCustom && tCustom === row.domain) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data:  { domainVerified: true },
        });
      }
    }

    const refreshed = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, subdomain: true, customDomain: true, domainVerified: true,
      },
    });
    if (refreshed) {
      await syncTenantDomainsFromTenant(refreshed);
    }

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.TENANT_DOMAIN_UPDATED, category: AuditCategory.TENANT,
      targetType: 'TenantDomain', targetId: row.id,
      targetName: row.domain,
      details:    { verify: true, type: row.type, tenantId },
      ipAddress:  ip,
    });

    return prisma.tenantDomain.findUnique({ where: { id: row.id } });
  }

  // ── User create / update (platform admin) ─────────────────────────────────

  async createUserByAdmin(
    adminId: string,
    adminEmail: string,
    input: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      tenantId: string;
      role: UserRole;
      plan?: Plan;
    },
    ip?: string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    const role = input.role;
    if (!ASSIGNABLE_USER_ROLES.includes(role)) {
      throw new Error('Geçersiz veya yasaklı rol.');
    }

    const email = input.email.trim().toLowerCase();
    const dup = await prisma.user.findFirst({ where: { email, tenantId: input.tenantId } });
    if (dup) throw new Error('Bu e-posta bu mağazada zaten kayıtlı.');

    const hashed = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email,
        password:  hashed,
        firstName: input.firstName?.trim() || 'User',
        lastName:  input.lastName?.trim() || '',
        role,
        tenantId:  input.tenantId,
        plan:      input.plan ?? Plan.STARTER,
        isActive:  true,
      },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.USER_CREATED_BY_ADMIN, category: AuditCategory.USER,
      targetType: 'User', targetId: user.id,
      targetName: `${user.firstName} ${user.lastName} <${user.email}>`,
      details: { tenantId: input.tenantId, role },
      ipAddress: ip,
    });

    return user;
  }

  async updateUserByAdmin(
    adminId: string,
    adminEmail: string,
    userId: string,
    input: { tenantId?: string; role?: UserRole; plan?: Plan; isActive?: boolean },
    ip?: string,
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (String(user.role).toUpperCase() === 'SUPER_ADMIN') {
      throw new Error('Super admin kullanıcısı bu API ile değiştirilemez.');
    }

    if (input.role && !ASSIGNABLE_USER_ROLES.includes(input.role)) {
      throw new Error('Geçersiz veya yasaklı rol.');
    }

    if (input.tenantId) {
      const t = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
      if (!t) throw new Error('Hedef tenant bulunamadı.');
      const emailDup = await prisma.user.findFirst({
        where: { email: user.email, tenantId: input.tenantId, NOT: { id: userId } },
      });
      if (emailDup) throw new Error('Bu e-posta hedef tenantta zaten var.');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.tenantId && { tenantId: input.tenantId }),
        ...(input.role && { role: input.role }),
        ...(input.plan && { plan: input.plan }),
        ...(typeof input.isActive === 'boolean' && { isActive: input.isActive }),
      },
    });

    await auditService.log({
      userId: adminId, userEmail: adminEmail, userRole: 'SUPER_ADMIN',
      action: AuditAction.USER_ROLE_CHANGED, category: AuditCategory.USER,
      targetType: 'User', targetId: userId,
      targetName: `${updated.firstName} ${updated.lastName} <${updated.email}>`,
      details: input,
      ipAddress: ip,
    });

    return updated;
  }

  // ── Billing overview (cross-tenant) ───────────────────────────────────────

  async getBillingOverview(filters: PaginationParams & {
    status?: PaymentStatus;
    tenantId?: string;
  }) {
    const { page = 1, limit = 30, status, tenantId } = filters;
    const skip = (page - 1) * limit;

    const payWhere: any = {};
    if (status) payWhere.status = status;
    if (tenantId) payWhere.tenantId = tenantId;

    const thirty = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      payments,
      paymentCount,
      failed30d,
      successSum,
      activeSubscriptions,
      pendingPayments,
    ] = await prisma.$transaction([
      prisma.payment.findMany({
        where:    payWhere,
        skip,
        take:     limit,
        orderBy:  { createdAt: 'desc' },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          user:   { select: { id: true, email: true } },
          subscription: { select: { id: true, plan: true, status: true, endDate: true } },
        },
      }),
      prisma.payment.count({ where: payWhere }),
      prisma.payment.count({
        where: { status: PaymentStatus.FAILED, createdAt: { gte: thirty } },
      }),
      prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum:  { amount: true },
      }),
      prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE, endDate: { gte: new Date() } },
      }),
      prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
    ]);

    return {
      payments: payments.map(p => ({
        id:            p.id,
        amount:        Number(p.amount),
        currency:      p.currency,
        status:        p.status,
        provider:      p.provider,
        transactionId: p.transactionId,
        createdAt:     p.createdAt,
        tenant:        p.tenant,
        user:          p.user,
        subscription:  p.subscription,
      })),
      pagination: {
        total:      paymentCount,
        page,
        limit,
        totalPages: Math.ceil(paymentCount / limit),
      },
      summary: {
        successfulRevenueTotal: Number(successSum._sum.amount ?? 0),
        activeSubscriptions,
        pendingPayments,
        failedPaymentsLast30Days: failed30d,
      },
    };
  }

  // ── Platform logs (tenant-scoped tables, cross-tenant read) ───────────────

  async getPlatformActivityLogs(filters: PaginationParams & { tenantId?: string; search?: string }) {
    const { page = 1, limit = 40, tenantId, search } = filters;
    const skip = (page - 1) * limit;
    const andParts: any[] = [{ type: LogType.USER_ACTION }];
    if (tenantId) andParts.push({ tenantId });
    if (search?.trim()) {
      const q = search.trim();
      andParts.push({
        OR: [
          { action: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: andParts };

    const [items, total] = await prisma.$transaction([
      prisma.log.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true, slug: true } } },
      }),
      prisma.log.count({ where }),
    ]);

    return {
      items: items.map(l => ({
        id: l.id, type: 'activity', logType: l.type, level: l.level,
        action: l.action, description: l.description,
        userName: l.userName, tenantId: l.tenantId,
        tenantName: l.tenant?.name ?? null,
        createdAt: l.createdAt,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async getPlatformErrorLogs(filters: PaginationParams & { tenantId?: string }) {
    const { page = 1, limit = 40, tenantId } = filters;
    const skip = (page - 1) * limit;
    const where: any = {
      OR: [
        { level: { in: [LogLevel.ERROR, LogLevel.CRITICAL] } },
        { type: LogType.ERROR },
      ],
    };
    if (tenantId) where.tenantId = tenantId;

    const [items, total] = await prisma.$transaction([
      prisma.log.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true, slug: true } } },
      }),
      prisma.log.count({ where }),
    ]);

    return {
      items: items.map(l => ({
        id: l.id, type: 'error', logType: l.type, level: l.level,
        action: l.action, description: l.description,
        metadata: l.metadata,
        tenantId: l.tenantId,
        tenantName: l.tenant?.name ?? null,
        createdAt: l.createdAt,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async getPlatformWebhookLogs(filters: PaginationParams & { tenantId?: string; success?: string }) {
    const { page = 1, limit = 40, tenantId } = filters;
    const skip = (page - 1) * limit;
    const successFilter = filters.success;
    const where: any = {};
    if (tenantId) {
      where.webhook = { tenantId };
    }
    if (successFilter === 'true')  where.success = true;
    if (successFilter === 'false') where.success = false;

    const [items, total] = await prisma.$transaction([
      prisma.webhookLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          webhook: {
            select: {
              id: true, url: true, tenantId: true,
              tenant: { select: { name: true, slug: true } },
            },
          },
        },
      }),
      prisma.webhookLog.count({ where }),
    ]);

    return {
      items: items.map(w => ({
        id:         w.id,
        type:       'webhook',
        event:      w.event,
        success:    w.success,
        statusCode: w.statusCode,
        attempts:   w.attempts,
        response:   w.response?.slice(0, 500) ?? null,
        createdAt:  w.createdAt,
        tenantId:   w.webhook.tenantId,
        tenantName: w.webhook.tenant?.name ?? null,
        webhookUrl: w.webhook.url,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }
}
