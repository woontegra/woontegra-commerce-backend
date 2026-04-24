import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

// ─── Audit Categories ─────────────────────────────────────────────────────────

export enum AuditCategory {
  AUTH     = 'AUTH',
  BILLING  = 'BILLING',
  ORDER    = 'ORDER',
  PRODUCT  = 'PRODUCT',
  CUSTOMER = 'CUSTOMER',
  TENANT   = 'TENANT',
  USER     = 'USER',
  SYSTEM   = 'SYSTEM',
  GENERAL  = 'GENERAL',
}

export enum AuditAction {
  // Auth
  LOGIN              = 'LOGIN',
  LOGOUT             = 'LOGOUT',
  REGISTER           = 'REGISTER',
  LOGIN_FAILED       = 'LOGIN_FAILED',
  PASSWORD_CHANGED   = 'PASSWORD_CHANGED',
  TOKEN_REFRESHED    = 'TOKEN_REFRESHED',

  // Billing
  PAYMENT_INITIATED  = 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS    = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED     = 'PAYMENT_FAILED',
  SUBSCRIPTION_CREATED    = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_ACTIVATED  = 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_CANCELED   = 'SUBSCRIPTION_CANCELED',
  SUBSCRIPTION_UPGRADED   = 'SUBSCRIPTION_UPGRADED',
  SUBSCRIPTION_DOWNGRADED = 'SUBSCRIPTION_DOWNGRADED',

  // Orders
  ORDER_CREATED      = 'ORDER_CREATED',
  ORDER_UPDATED      = 'ORDER_UPDATED',
  ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED',
  ORDER_DELETED      = 'ORDER_DELETED',

  // Products
  PRODUCT_CREATED    = 'PRODUCT_CREATED',
  PRODUCT_UPDATED    = 'PRODUCT_UPDATED',
  PRODUCT_DELETED    = 'PRODUCT_DELETED',

  // Customers
  CUSTOMER_CREATED   = 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED   = 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED   = 'CUSTOMER_DELETED',

  // Tenant management (admin)
  TENANT_SUSPENDED   = 'TENANT_SUSPENDED',
  TENANT_ACTIVATED   = 'TENANT_ACTIVATED',
  TENANT_DELETED     = 'TENANT_DELETED',
  TENANT_PLAN_CHANGED = 'TENANT_PLAN_CHANGED',
  TENANT_STATUS_CHANGED = 'TENANT_STATUS_CHANGED',

  // User management (admin)
  USER_BANNED        = 'USER_BANNED',
  USER_UNBANNED      = 'USER_UNBANNED',
  USER_ROLE_CHANGED  = 'USER_ROLE_CHANGED',
  USER_DELETED       = 'USER_DELETED',

  // Feature flags
  FEATURE_TOGGLED    = 'FEATURE_TOGGLED',

  // System
  CRON_RUN           = 'CRON_RUN',
  CONFIG_CHANGED     = 'CONFIG_CHANGED',
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  // Who
  userId?:    string;
  userEmail?: string;
  userRole?:  string;
  tenantId?:  string;

  // What
  action:     AuditAction | string;
  category?:  AuditCategory | string;
  targetType: string;
  targetId?:  string;
  targetName?: string;

  // Result
  status?:   'SUCCESS' | 'FAILURE' | 'WARNING';
  errorMsg?: string;

  // Context
  ipAddress?: string;
  userAgent?: string;
  details?:   Record<string, unknown>;

  // Request helper (auto-extract ip + userAgent)
  req?: Request;
}

// ─── AuditService ─────────────────────────────────────────────────────────────

export class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    try {
      const ip        = entry.ipAddress ?? this.extractIp(entry.req);
      const userAgent = entry.userAgent ?? entry.req?.headers?.['user-agent'] ?? undefined;

      await prisma.auditLog.create({
        data: {
          userId:     entry.userId     ?? null,
          userEmail:  entry.userEmail  ?? null,
          userRole:   entry.userRole   ?? null,
          tenantId:   entry.tenantId   ?? null,

          // backward-compat aliases
          adminId:    entry.userId     ?? null,
          adminEmail: entry.userEmail  ?? null,

          action:     entry.action,
          category:   entry.category  ?? AuditCategory.GENERAL,
          targetType: entry.targetType,
          targetId:   entry.targetId  ?? '',
          targetName: entry.targetName ?? null,

          status:    entry.status   ?? 'SUCCESS',
          errorMsg:  entry.errorMsg ?? null,

          ipAddress: ip        ?? null,
          userAgent: userAgent  ?? null,
          details:   entry.details ?? null,
        },
      });
    } catch (err) {
      // Never crash the main flow on audit failure
      logger.error({ message: '[Audit] Write failed', error: (err as Error).message });
    }
  }

  // Convenience: log a failure
  async logFailure(entry: Omit<AuditEntry, 'status'> & { errorMsg: string }): Promise<void> {
    await this.log({ ...entry, status: 'FAILURE' });
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async getLogs(filters: {
    page?:       number;
    limit?:      number;
    search?:     string;
    action?:     string;
    category?:   string;
    targetType?: string;
    tenantId?:   string;
    userId?:     string;
    status?:     string;
    from?:       Date;
    to?:         Date;
  }) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.search) {
      where.OR = [
        { action:     { contains: filters.search, mode: 'insensitive' } },
        { userEmail:  { contains: filters.search, mode: 'insensitive' } },
        { targetType: { contains: filters.search, mode: 'insensitive' } },
        { targetName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.action)     where.action     = filters.action;
    if (filters.category)   where.category   = filters.category;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.tenantId)   where.tenantId   = filters.tenantId;
    if (filters.userId)     where.userId     = filters.userId;
    if (filters.status)     where.status     = filters.status;

    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to   ? { lte: filters.to   } : {}),
      };
    }

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private extractIp(req?: Request): string | undefined {
    if (!req) return undefined;
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress;
  }
}

// Singleton
export const auditService = new AuditService();
