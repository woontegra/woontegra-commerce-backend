import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import { orderSyncService } from '../trendyol/trendyol-order-sync.service';
import { syncQueue } from '../trendyol/trendyol-sync-queue.service';

const prisma = new PrismaClient();

/**
 * Runs daily at 00:05.
 *
 * 1. Trial tenants whose trialEndsAt has passed and have no active subscription → PAST_DUE
 * 2. Active tenants whose subscription endDate has passed → PAST_DUE
 */
async function runLifecycleTick() {
  const now = new Date();

  logger.info({ message: '[Lifecycle Cron] Starting tick', timestamp: now });

  try {
    // ── 1. Expired trials without active subscription ──────────────────────
    const expiredTrials = await prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lt: now },
      },
      select: { id: true, name: true },
    });

    for (const tenant of expiredTrials) {
      const activeSubscription = await prisma.subscription.findFirst({
        where: { tenantId: tenant.id, status: 'ACTIVE' },
      });

      if (!activeSubscription) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { status: 'PAST_DUE' },
        });

        logger.warn({
          message: '[Lifecycle Cron] Trial expired → PAST_DUE',
          tenantId: tenant.id,
          tenantName: tenant.name,
        });
      }
    }

    // ── 2. Active tenants whose subscription has lapsed ──────────────────────
    const activeTenants = await prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
    });

    for (const tenant of activeTenants) {
      const activeSubscription = await prisma.subscription.findFirst({
        where: {
          tenantId: tenant.id,
          status: 'ACTIVE',
          endDate: { gt: now },
        },
      });

      if (!activeSubscription) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { status: 'PAST_DUE' },
        });

        logger.warn({
          message: '[Lifecycle Cron] Subscription lapsed → PAST_DUE',
          tenantId: tenant.id,
          tenantName: tenant.name,
        });
      }
    }

    logger.info({
      message: '[Lifecycle Cron] Tick complete',
      expiredTrials: expiredTrials.length,
      checkedActive: activeTenants.length,
    });
  } catch (err) {
    logger.error({ message: '[Lifecycle Cron] Error during tick', err });
  }
}

/**
 * Register the cron schedule.
 * Call this once from main.ts at startup.
 */
export function startLifecycleCron() {
  // Every day at 00:05 — trial/subscription lifecycle
  cron.schedule('5 0 * * *', runLifecycleTick, { timezone: 'Europe/Istanbul' });
  logger.info({ message: '[Lifecycle Cron] Scheduled (daily 00:05 Istanbul)' });

  // Every 5 minutes — Trendyol order sync
  cron.schedule('*/5 * * * *', async () => {
    logger.info({ message: '[Order Sync Cron] Trendyol sipariş sync başlıyor' });
    try {
      await orderSyncService.syncAllTenants();
    } catch (err: any) {
      logger.error({ message: '[Order Sync Cron] Hata', err: err.message });
    }
  }, { timezone: 'Europe/Istanbul' });
  logger.info({ message: '[Order Sync Cron] Scheduled (her 5 dakika)' });

  // Every 2 minutes — Trendyol price/stock sync queue
  cron.schedule('*/2 * * * *', async () => {
    try {
      const r = await syncQueue.processSyncQueue();
      if (r.processed > 0) {
        logger.info({ message: '[PriceStock Sync] Kuyruk işlendi', ...r });
      }
    } catch (err: any) {
      logger.error({ message: '[PriceStock Sync] Cron hatası', err: err.message });
    }
  }, { timezone: 'Europe/Istanbul' });
  logger.info({ message: '[PriceStock Sync Cron] Scheduled (her 2 dakika)' });

  // Daily cleanup — 1 haftadan eski "success" kayıtları sil
  cron.schedule('30 2 * * *', async () => {
    const deleted = await syncQueue.cleanupOld(7).catch(() => 0);
    if (deleted > 0) logger.info({ message: `[PriceStock Sync] ${deleted} eski kayıt temizlendi` });
  }, { timezone: 'Europe/Istanbul' });

  // Run once on startup to catch any missed ticks
  runLifecycleTick();
}
