import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

// Write operations that are blocked in PAST_DUE / TRIAL-expired state
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Routes always accessible regardless of status (billing, auth, admin)
const ALWAYS_ALLOWED_PREFIXES = [
  '/api/billing',
  '/api/auth',
  '/api/admin',
  '/api/health',
];

function isAlwaysAllowed(path: string): boolean {
  return ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Tenant lifecycle access control middleware.
 *
 * - SUPER_ADMIN: always passes through
 * - TRIAL / ACTIVE: full access
 * - PAST_DUE: read-only (blocks write operations)
 * - SUSPENDED / CANCELED: 403 on all requests
 */
export const tenantLifecycleGuard = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // Skip for unauthenticated requests or always-allowed routes
  if (!req.user || isAlwaysAllowed(req.path)) {
    return next();
  }

  // Super admin bypasses all lifecycle checks
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  const tenantId = req.user.tenantId;
  if (!tenantId) return next();

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, trialEndsAt: true, name: true },
    });

    if (!tenant) return next();

    const status = tenant.status as string;

    // ── Hard lock: SUSPENDED / CANCELED ──────────────────────────────────────
    if (status === 'SUSPENDED' || status === 'CANCELED') {
      logger.warn({
        message: 'Tenant lifecycle access denied',
        tenantId,
        status,
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({
        success: false,
        message:
          status === 'SUSPENDED'
            ? 'Hesabınız askıya alınmıştır. Destek ile iletişime geçin.'
            : 'Hesabınız iptal edilmiştir. Lütfen tekrar abone olun.',
        code: status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_CANCELED',
        tenantStatus: status,
      });
    }

    // ── Soft lock: PAST_DUE — readonly only ──────────────────────────────────
    if (status === 'PAST_DUE' && WRITE_METHODS.includes(req.method)) {
      return res.status(402).json({
        success: false,
        message:
          'Aboneliğiniz sona erdi. Devam etmek için ödeme yapın.',
        code: 'TENANT_PAST_DUE',
        tenantStatus: status,
      });
    }

    // ── Trial expired but status not yet updated (edge case before cron runs) ─
    if (
      status === 'TRIAL' &&
      tenant.trialEndsAt &&
      new Date() > tenant.trialEndsAt &&
      WRITE_METHODS.includes(req.method)
    ) {
      return res.status(402).json({
        success: false,
        message:
          'Deneme süreniz sona erdi. Devam etmek için bir plan seçin.',
        code: 'TRIAL_EXPIRED',
        tenantStatus: status,
      });
    }

    next();
  } catch (err) {
    logger.error({ message: 'Lifecycle middleware error', err });
    next(); // fail open — don't block users due to internal errors
  }
};

/**
 * Attach tenant lifecycle info to every authenticated response.
 * Frontend reads `res.locals.tenantLifecycle` to show banners.
 */
export const attachTenantLifecycle = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || req.user.role === 'SUPER_ADMIN') return next();

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { status: true, trialEndsAt: true },
    });

    if (tenant) {
      res.locals.tenantLifecycle = {
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt,
      };
    }
  } catch {
    // non-blocking
  }

  next();
};
