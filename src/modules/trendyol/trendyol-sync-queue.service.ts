/**
 * Trendyol Fiyat/Stok Sync Queue Service
 *
 * Bir ürünün fiyatı veya stoğu değiştiğinde bu servisi çağır.
 * Worker (processSyncQueue) her 2 dk çalışarak Trendyol'a batch gönderir.
 *
 * Kullanım:
 *   import { syncQueue } from './trendyol-sync-queue.service';
 *   await syncQueue.enqueue({ tenantId, barcode, listPrice, salePrice, quantity });
 */

import prisma from '../../config/database';
import { TrendyolClient }    from '../marketplace/clients/trendyol.client';
import { logger }            from '../../config/logger';

export interface SyncItem {
  tenantId:  string;
  barcode:   string;
  listPrice: number;
  salePrice: number;
  quantity:  number;
}

export interface ProcessResult {
  processed: number;
  success:   number;
  failed:    number;
}

// ─── Max aynı anda kaç batch paralel çalışsın ────────────────────────────────
const MAX_BATCH = 100;

// ─── Kaç başarısız denemeden sonra abandoned sayılsın ────────────────────────
const MAX_ATTEMPTS = 3;

class TrendyolSyncQueueService {

  /**
   * Kuyruğa yeni bir fiyat/stok güncelleme ekler.
   * Aynı tenant + barcode için zaten "pending" kayıt varsa üzerine yazar
   * (gereksiz birikimleri önler).
   */
  async enqueue(item: SyncItem): Promise<void> {
    if (!item.barcode || !item.tenantId) return;
    if (item.salePrice < 0) {
      logger.warn({ message: '[SyncQueue] Negatif fiyat reddedildi', ...item });
      return;
    }
    if (item.quantity < 0) item.quantity = 0;

    // Aynı barcode için bekleyen kayıt varsa güncelle — çift kuyruğu önler
    const existing = await prisma.trendyolSyncQueue.findFirst({
      where:  { tenantId: item.tenantId, barcode: item.barcode, status: 'pending' },
      select: { id: true },
    });

    if (existing) {
      await prisma.trendyolSyncQueue.update({
        where: { id: existing.id },
        data: {
          listPrice: item.listPrice,
          salePrice: item.salePrice,
          quantity:  item.quantity,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.trendyolSyncQueue.create({
        data: {
          tenantId:  item.tenantId,
          barcode:   item.barcode,
          listPrice: item.listPrice,
          salePrice: item.salePrice,
          quantity:  item.quantity,
        },
      });
    }
  }

  /**
   * Birden fazla ürünü aynı anda kuyruğa ekler (N+1 önleme).
   * Mevcut pending kayıtları günceller, olmayanlar için yeni kayıt açar.
   */
  async enqueueBatch(items: SyncItem[]): Promise<void> {
    if (items.length === 0) return;

    const valid = items.filter(i => i.barcode && i.tenantId && i.salePrice >= 0);
    valid.forEach(i => { if (i.quantity < 0) i.quantity = 0; });

    if (valid.length === 0) return;

    // Mevcut pending kayıtları bul
    const barcodes  = valid.map(i => i.barcode);
    const tenantId  = valid[0].tenantId; // Batch genelde aynı tenant'a aittir
    const existing  = await prisma.trendyolSyncQueue.findMany({
      where:  { tenantId, barcode: { in: barcodes }, status: 'pending' },
      select: { id: true, barcode: true },
    });
    const existingMap = new Map(existing.map(e => [e.barcode, e.id]));

    const toUpdate = valid.filter(i => existingMap.has(i.barcode));
    const toCreate = valid.filter(i => !existingMap.has(i.barcode));

    await Promise.all([
      ...toUpdate.map(i => prisma.trendyolSyncQueue.update({
        where: { id: existingMap.get(i.barcode)! },
        data:  { listPrice: i.listPrice, salePrice: i.salePrice, quantity: i.quantity, updatedAt: new Date() },
      })),
      toCreate.length > 0
        ? prisma.trendyolSyncQueue.createMany({ data: toCreate, skipDuplicates: true })
        : Promise.resolve(),
    ]);
  }

  /**
   * Worker: bekleyen kayıtları çekip tenant başına Trendyol'a gönderir.
   * Cron (her 2 dk) ve manuel endpoint tarafından çağrılır.
   */
  async processSyncQueue(): Promise<ProcessResult> {
    const result: ProcessResult = { processed: 0, success: 0, failed: 0 };

    // Sadece "pending" ve daha önce başarısız olanları (MAX_ATTEMPTS altında) al
    const pending = await prisma.trendyolSyncQueue.findMany({
      where: {
        status:   { in: ['pending', 'error'] },
        attempts: { lt: MAX_ATTEMPTS },
      },
      take:    MAX_BATCH,
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) return result;

    // Tenant bazında grupla
    const byTenant = new Map<string, typeof pending>();
    for (const item of pending) {
      if (!byTenant.has(item.tenantId)) byTenant.set(item.tenantId, []);
      byTenant.get(item.tenantId)!.push(item);
    }

    for (const [tenantId, batch] of byTenant) {
      const ids = batch.map(i => i.id);

      // "processing" olarak işaretle
      await prisma.trendyolSyncQueue.updateMany({
        where: { id: { in: ids } },
        data:  { status: 'processing', attempts: { increment: 1 } },
      });

      try {
        // Trendyol entegrasyonunu çek
        const integration = await prisma.trendyolIntegration.findFirst({
          where:  { tenantId, isActive: true },
          select: { apiKey: true, apiSecret: true, supplierId: true },
        });

        if (!integration) {
          throw new Error('Aktif Trendyol entegrasyonu yok');
        }

        const client = new TrendyolClient({
          apiKey:    integration.apiKey,
          apiSecret: integration.apiSecret,
          sellerId:  integration.supplierId,
        });

        // Trendyol'a gönder
        await client.updateStockAndPrice(
          batch.map(item => ({
            barcode:   item.barcode,
            quantity:  item.quantity,
            price:     Number(item.salePrice),
          })),
        );

        // Başarılı
        await prisma.trendyolSyncQueue.updateMany({
          where: { id: { in: ids } },
          data:  { status: 'success', errorMsg: null, processedAt: new Date() },
        });

        result.success   += batch.length;
        result.processed += batch.length;

        logger.info({
          message: `[SyncQueue] ${batch.length} ürün Trendyol'a gönderildi`,
          tenantId,
        });

      } catch (err: any) {
        const errMsg = err.message ?? 'Bilinmeyen hata';

        // Hatalı olarak işaretle — attempts MAX_ATTEMPTS'e ulaşınca artık işlenmez
        await prisma.trendyolSyncQueue.updateMany({
          where: { id: { in: ids } },
          data:  { status: 'error', errorMsg: errMsg.slice(0, 500) },
        });

        result.failed    += batch.length;
        result.processed += batch.length;

        logger.error({
          message: `[SyncQueue] Trendyol gönderim hatası`,
          tenantId,
          batchSize: batch.length,
          err: errMsg,
        });
      }
    }

    return result;
  }

  /**
   * Başarısız kayıtları (MAX_ATTEMPTS dolmamış olanları) yeniden "pending" yap.
   */
  async retryFailed(tenantId?: string): Promise<number> {
    const where: any = { status: 'error', attempts: { lt: MAX_ATTEMPTS } };
    if (tenantId) where.tenantId = tenantId;

    const r = await prisma.trendyolSyncQueue.updateMany({
      where,
      data: { status: 'pending' },
    });
    return r.count;
  }

  /**
   * Belirli bir süre öncesinden eski "success" kayıtlarını temizler.
   * Cron tarafından günlük çağrılır.
   */
  async cleanupOld(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const r = await prisma.trendyolSyncQueue.deleteMany({
      where: {
        status:    'success',
        createdAt: { lt: cutoff },
      },
    });
    return r.count;
  }

  /** Kuyruk durumu özeti (dashboard için) */
  async getStats(tenantId: string) {
    const [pending, processing, success, error] = await Promise.all([
      prisma.trendyolSyncQueue.count({ where: { tenantId, status: 'pending'    } }),
      prisma.trendyolSyncQueue.count({ where: { tenantId, status: 'processing' } }),
      prisma.trendyolSyncQueue.count({ where: { tenantId, status: 'success'    } }),
      prisma.trendyolSyncQueue.count({ where: { tenantId, status: 'error'      } }),
    ]);
    return { pending, processing, success, error, total: pending + processing + success + error };
  }
}

export const syncQueue = new TrendyolSyncQueueService();
