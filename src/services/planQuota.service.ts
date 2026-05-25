import { Plan, SubscriptionStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { PLAN_CONFIG } from '../config/plans';
import { AppError } from '../common/middleware/AppError';
import { cache } from '../config/redis';

/** API + frontend ortak hata kodu */
export const PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED';

export const PLAN_LIMIT_EXCEEDED_MESSAGE = 'Ürün limitine ulaştınız';

const PRODUCT_COUNT_CACHE_KEY = (tenantId: string) => `quota:tenant:${tenantId}:productCount`;
/** Ürün sayısı önbelleği (Redis yok / hata olsa bile DB’ye düşer) */
const PRODUCT_COUNT_CACHE_TTL_SEC = 60;

function limitsForPlan(plan: Plan) {
  const cfg = PLAN_CONFIG as Record<string, (typeof PLAN_CONFIG)[keyof typeof PLAN_CONFIG]>;
  return cfg[plan] ?? cfg.STARTER;
}

export async function getEffectivePlanForTenant(tenantId: string): Promise<Plan> {
  const activeSub = await prisma.subscription.findFirst({
    where:   { tenantId, status: SubscriptionStatus.ACTIVE },
    orderBy: { createdAt: 'desc' },
    select:  { plan: true },
  });
  if (activeSub?.plan) return activeSub.plan;

  const u = await prisma.user.findFirst({
    where: {
      tenantId,
      role: { in: [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
    },
    orderBy: { createdAt: 'asc' },
    select:  { plan: true },
  });
  return u?.plan ?? Plan.STARTER;
}

/** Tenant’ın geçerli planına göre ürün üst sınırı (ENTERPRISE = sınırsız). */
export async function getTenantPlanLimit(tenantId: string): Promise<{
  plan: Plan;
  maxProducts: number;
  unlimited: boolean;
}> {
  const plan        = await getEffectivePlanForTenant(tenantId);
  const maxProducts = limitsForPlan(plan).maxProducts;
  const unlimited   = maxProducts === -1;
  return { plan, maxProducts, unlimited };
}

async function countProductsUncached(tenantId: string): Promise<number> {
  return prisma.product.count({ where: { tenantId } });
}

/**
 * Tenant ürün kullanımı (adet).
 * `useCache: true` (varsayılan): Redis’te kısa TTL ile önbellek.
 * Limit kontrolü (`checkProductLimit`) her zaman `useCache: false` kullanır.
 */
export async function getTenantUsage(
  tenantId: string,
  opts?: { useCache?: boolean },
): Promise<{ productCount: number }> {
  const useCache = opts?.useCache !== false;
  const key      = PRODUCT_COUNT_CACHE_KEY(tenantId);

  if (useCache) {
    const hit = await cache.get<{ productCount: number }>(key);
    if (hit != null && typeof hit.productCount === 'number') {
      return { productCount: hit.productCount };
    }
  }

  const productCount = await countProductsUncached(tenantId);

  if (useCache) {
    await cache.set(key, { productCount }, PRODUCT_COUNT_CACHE_TTL_SEC).catch(() => {});
  }

  return { productCount };
}

export async function invalidateTenantProductUsageCache(tenantId: string): Promise<void> {
  await cache.del(PRODUCT_COUNT_CACHE_KEY(tenantId)).catch(() => {});
}

export interface ProductQuotaSnapshot {
  plan:          Plan;
  current:       number;
  max:           number;
  unlimited:     boolean;
  usagePercent:  number;
}

export async function getProductQuotaForTenant(tenantId: string): Promise<ProductQuotaSnapshot> {
  const [{ plan, maxProducts, unlimited }, { productCount: current }] = await Promise.all([
    getTenantPlanLimit(tenantId),
    getTenantUsage(tenantId, { useCache: true }),
  ]);
  const usagePercent = unlimited || maxProducts <= 0
    ? 0
    : Math.min(100, Math.round((current / maxProducts) * 100));

  return {
    plan,
    current,
    max: maxProducts,
    unlimited,
    usagePercent,
  };
}

/** In-memory tracker for bulk/XML import (avoids N DB counts per row). */
export async function createProductQuotaTracker(tenantId: string) {
  const limit = await getTenantPlanLimit(tenantId);
  const usage = await getTenantUsage(tenantId, { useCache: false });
  let used    = usage.productCount;
  let skippedDueToPlanLimit = 0;

  return {
    plan:       limit.plan,
    unlimited: limit.unlimited,
    max:        limit.maxProducts,
    /** Mevcut (başlangıç) ürün adedi — import döngüsü içinde `used` ile takip edilir. */
    initialCount: usage.productCount,
    remainingSlots(): number {
      if (limit.unlimited) return Number.POSITIVE_INFINITY;
      return Math.max(0, limit.maxProducts - used);
    },
    canCreate(): boolean {
      return limit.unlimited || used < limit.maxProducts;
    },
    recordCreated(): void {
      if (!limit.unlimited) used += 1;
    },
    /** Yeni ürün kotası dolduğu için satır atlandığında (XML/CSV). */
    recordPlanLimitSkip(): void {
      skippedDueToPlanLimit += 1;
    },
    getSkippedPlanLimit(): number {
      return skippedDueToPlanLimit;
    },
  };
}

/**
 * Yeni ürün(ler) eklenebilir mi — merkezi kota kontrolü (bypass yok).
 * `additionalProducts`: eklenecek yeni ürün adedi (varsayılan 1).
 * Limit aşılıyorsa `AppError` — `code: PLAN_LIMIT_EXCEEDED`, `message: Ürün limitine ulaştınız`.
 */
export async function checkProductLimit(tenantId: string, additionalProducts = 1): Promise<void> {
  const n = Math.floor(additionalProducts);
  if (n < 1) return;

  const { maxProducts, unlimited } = await getTenantPlanLimit(tenantId);
  if (unlimited) return;

  const { productCount } = await getTenantUsage(tenantId, { useCache: false });
  if (productCount + n > maxProducts) {
    throw new AppError(PLAN_LIMIT_EXCEEDED_MESSAGE, 403, PLAN_LIMIT_EXCEEDED);
  }
}

