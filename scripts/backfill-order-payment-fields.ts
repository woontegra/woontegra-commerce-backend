// @ts-nocheck
/**
 * Eski siparişler için paymentProvider / paymentStatus (ve güvenli kanıtlı tarih alanları) backfill.
 *
 * Varsayılan: DRY-RUN (DB yazmaz). Gerçek güncelleme: --write
 *
 * Kullanım (backend klasöründen):
 *   npm run backfill:order-payments
 *   npm run backfill:order-payments:write
 *   TENANT_ID=<uuid> npm run backfill:order-payments:write
 */

import { PrismaClient } from '@prisma/client';
import {
  buildOrderPaymentBackfillPatch,
  countShippingBackfillGaps,
  truncateNotes,
  type BackfillOrderRow,
} from '../src/modules/orders/order-payment-backfill.util';

const prisma = new PrismaClient();

const writeMode = process.argv.includes('--write');
const dryRun = !writeMode;
const tenantFilter =
  process.env.TENANT_ID?.trim()
  || (() => {
    const i = process.argv.indexOf('--tenant');
    return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
  })();

type TenantStats = {
  tenantId: string;
  tenantName: string;
  scanned: number;
  willUpdateProvider: number;
  willUpdateStatus: number;
  willUpdatePaymentApprovedAt: number;
  willUpdatePaymentFailedAt: number;
  skippedAlreadyFilled: number;
  unresolvedProvider: number;
  statusSkippedUnsafe: number;
  missingShippedAt: number;
  missingTrackingFields: number;
  updated: number;
  byProvider: Record<string, number>;
};

const unresolvedSamples: Array<{
  orderNumber: string;
  tenantId: string;
  status: string;
  notes: string;
}> = [];

function initTenantStats(tenantId: string, tenantName: string): TenantStats {
  return {
    tenantId,
    tenantName,
    scanned: 0,
    willUpdateProvider: 0,
    willUpdateStatus: 0,
    willUpdatePaymentApprovedAt: 0,
    willUpdatePaymentFailedAt: 0,
    skippedAlreadyFilled: 0,
    unresolvedProvider: 0,
    statusSkippedUnsafe: 0,
    missingShippedAt: 0,
    missingTrackingFields: 0,
    updated: 0,
    byProvider: {},
  };
}

function hasPatchFields(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: tenantFilter ? { id: tenantFilter } : undefined,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (tenantFilter && tenants.length === 0) {
    console.error(`Tenant bulunamadı: ${tenantFilter}`);
    process.exit(1);
  }

  const global = {
    scanned: 0,
    willUpdateProvider: 0,
    willUpdateStatus: 0,
    willUpdatePaymentApprovedAt: 0,
    willUpdatePaymentFailedAt: 0,
    skippedAlreadyFilled: 0,
    unresolvedProvider: 0,
    statusSkippedUnsafe: 0,
    missingShippedAt: 0,
    missingTrackingFields: 0,
    updated: 0,
    byProvider: {} as Record<string, number>,
  };

  const tenantStatsMap = new Map<string, TenantStats>();

  for (const tenant of tenants) {
    tenantStatsMap.set(tenant.id, initTenantStats(tenant.id, tenant.name));

    const orders = await prisma.order.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        orderNumber: true,
        tenantId: true,
        status: true,
        notes: true,
        paymentProvider: true,
        paymentStatus: true,
        paymentApprovedAt: true,
        paymentFailedAt: true,
        bankTransferApprovedEmailSentAt: true,
        shippingCarrier: true,
        shippingTrackingNumber: true,
        shippedAt: true,
        updatedAt: true,
        paymentSessions: {
          select: {
            provider: true,
            status: true,
            updatedAt: true,
            createdAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const stats = tenantStatsMap.get(tenant.id)!;

    for (const row of orders) {
      const order = row as BackfillOrderRow;
      stats.scanned++;
      global.scanned++;

      const decision = buildOrderPaymentBackfillPatch(order);
      const gaps = countShippingBackfillGaps(order);
      if (gaps.missingShippedAt) {
        stats.missingShippedAt++;
        global.missingShippedAt++;
      }
      if (gaps.missingTrackingFields) {
        stats.missingTrackingFields++;
        global.missingTrackingFields++;
      }

      if (decision.unresolvedProvider && !order.paymentProvider) {
        stats.unresolvedProvider++;
        global.unresolvedProvider++;
        if (unresolvedSamples.length < 20) {
          unresolvedSamples.push({
            orderNumber: order.orderNumber,
            tenantId: order.tenantId,
            status: order.status,
            notes: truncateNotes(order.notes),
          });
        }
      }

      if (decision.statusSkippedUnsafe) {
        stats.statusSkippedUnsafe++;
        global.statusSkippedUnsafe++;
      }

      if (decision.skippedAlreadyFilled && !hasPatchFields(decision.patch)) {
        stats.skippedAlreadyFilled++;
        global.skippedAlreadyFilled++;
      }

      if (decision.willUpdateProvider) {
        stats.willUpdateProvider++;
        global.willUpdateProvider++;
        const p = decision.patch.paymentProvider!;
        stats.byProvider[p] = (stats.byProvider[p] ?? 0) + 1;
        global.byProvider[p] = (global.byProvider[p] ?? 0) + 1;
      }
      if (decision.willUpdateStatus) {
        stats.willUpdateStatus++;
        global.willUpdateStatus++;
      }
      if (decision.willUpdatePaymentApprovedAt) {
        stats.willUpdatePaymentApprovedAt++;
        global.willUpdatePaymentApprovedAt++;
      }
      if (decision.willUpdatePaymentFailedAt) {
        stats.willUpdatePaymentFailedAt++;
        global.willUpdatePaymentFailedAt++;
      }

      if (!hasPatchFields(decision.patch)) continue;

      if (writeMode) {
        await prisma.order.update({
          where: { id: order.id },
          data: decision.patch,
        });
        stats.updated++;
        global.updated++;
      }
    }
  }

  console.log('\nBackfill Order Payment Fields');
  console.log(`Mode: ${dryRun ? 'DRY_RUN' : 'WRITE'}`);
  if (tenantFilter) console.log(`Tenant filter: ${tenantFilter}`);
  console.log('');
  console.log(`Scanned orders: ${global.scanned}`);
  console.log(`Will update paymentProvider: ${global.willUpdateProvider}`);
  console.log(`Will update paymentStatus: ${global.willUpdateStatus}`);
  console.log(`Will update paymentApprovedAt: ${global.willUpdatePaymentApprovedAt}`);
  console.log(`Will update paymentFailedAt: ${global.willUpdatePaymentFailedAt}`);
  console.log(`Skipped (no changes needed): ${global.skippedAlreadyFilled}`);
  console.log(`Unresolved provider: ${global.unresolvedProvider}`);
  console.log(`Unsafe paymentStatus skipped: ${global.statusSkippedUnsafe}`);
  console.log(`SHIPPED/DELIVERED missing shippedAt (report only): ${global.missingShippedAt}`);
  console.log(`SHIPPED/DELIVERED missing tracking fields (report only): ${global.missingTrackingFields}`);
  console.log('');
  console.log('Email sent timestamp fields: NOT backfilled (no reliable outbox log).');
  console.log('Shipping carrier/tracking/shippedAt: NOT written (report only).');
  console.log('');

  if (Object.keys(global.byProvider).length > 0) {
    console.log('By provider (paymentProvider fills):');
    for (const [k, v] of Object.entries(global.byProvider).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('');
  }

  console.log('By tenant:');
  for (const s of tenantStatsMap.values()) {
    if (s.scanned === 0) continue;
    const updates =
      s.willUpdateProvider
      + s.willUpdateStatus
      + s.willUpdatePaymentApprovedAt
      + s.willUpdatePaymentFailedAt;
    console.log(
      `- ${s.tenantName} (${s.tenantId}): scanned ${s.scanned}, `
      + `provider ${s.willUpdateProvider}, status ${s.willUpdateStatus}, `
      + `unresolved ${s.unresolvedProvider}, unsafe status skip ${s.statusSkippedUnsafe}`
      + (writeMode ? `, written ${s.updated}` : ''),
    );
  }

  if (writeMode) {
    console.log(`\nUpdated orders (rows with any patch): ${global.updated}`);
  } else if (
    global.willUpdateProvider
    + global.willUpdateStatus
    + global.willUpdatePaymentApprovedAt
    + global.willUpdatePaymentFailedAt
    > 0
  ) {
    console.log('\nUygulamak için: npm run backfill:order-payments:write');
  }

  if (unresolvedSamples.length > 0) {
    console.log('\nUnresolved samples (max 20):');
    for (const u of unresolvedSamples) {
      console.log(
        `  #${u.orderNumber} tenant=${u.tenantId} status=${u.status} notes="${u.notes}"`,
      );
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
