import { Prisma, TenantUsageAction } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../config/logger';

/** Fire-and-forget; istek süresini bloke etmez. */
export function logTenantUsage(tenantId: string | null | undefined, action: TenantUsageAction): void {
  if (!tenantId) return;
  void prisma.tenantUsageLog
    .create({
      data: { tenantId, action },
    })
    .catch((err) => {
      logger.warn({
        message: '[tenant_usage_logs] insert failed',
        tenantId,
        action,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

export async function getTenantUsageSummary(tenantId: string): Promise<{
  lastLoginAt: string | null;
  totalLogins: number;
  productCreatedCount: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      lastLoginAt: Date | null;
      totalLogins: bigint;
      productCreatedCount: bigint;
    }>
  >(Prisma.sql`
    SELECT
      MAX("createdAt") FILTER (WHERE "action" = 'LOGIN'::"TenantUsageAction") AS "lastLoginAt",
      COUNT(*) FILTER (WHERE "action" = 'LOGIN'::"TenantUsageAction") AS "totalLogins",
      COUNT(*) FILTER (WHERE "action" = 'PRODUCT_CREATE'::"TenantUsageAction") AS "productCreatedCount"
    FROM "tenant_usage_logs"
    WHERE "tenantId" = ${tenantId}
  `);

  const row = rows[0];
  if (!row) {
    return { lastLoginAt: null, totalLogins: 0, productCreatedCount: 0 };
  }

  return {
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    totalLogins: Number(row.totalLogins ?? 0),
    productCreatedCount: Number(row.productCreatedCount ?? 0),
  };
}
