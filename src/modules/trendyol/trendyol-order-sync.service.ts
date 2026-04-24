import prisma from '../../config/database';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { logger } from '../../config/logger';

export interface OrderSyncResult {
  synced:  number;
  skipped: number;
  errors:  number;
  details: string[];
}

export class TrendyolOrderSyncService {

  /**
   * Belirli bir tenant için Trendyol siparişlerini çeker ve kayıt eder.
   * - Son sync zamanından (lastOrderSync) itibaren ya da son 7 günü alır
   * - Duplicate kontrolü: @@unique([tenantId, orderNumber])
   * - Barkod üzerinden ürün/varyant eşleştirir
   * - Stock düşer (Stock.quantity + ProductVariant.stockQuantity)
   * - Transaction güvenli
   */
  async syncForTenant(tenantId: string): Promise<OrderSyncResult> {
    const integration = await prisma.trendyolIntegration.findFirst({
      where: { tenantId, isActive: true },
    });

    if (!integration) throw new Error('Aktif Trendyol entegrasyonu bulunamadı.');

    const client = new TrendyolClient({
      apiKey:    integration.apiKey,
      apiSecret: integration.apiSecret,
      sellerId:  integration.supplierId,
    });

    // Son sync'ten itibaren ya da son 7 gün
    const sinceMs = integration.lastOrderSync
      ? integration.lastOrderSync.getTime() - 5 * 60 * 1000 // 5 dk örtüşme
      : Date.now() - 7 * 24 * 60 * 60 * 1000;

    logger.info({
      message: '[OrderSync] Sipariş çekiliyor',
      tenantId,
      since: new Date(sinceMs).toISOString(),
    });

    let orders: any[];
    try {
      orders = await client.getOrders({
        startDate: sinceMs,
        status:    'Created,Picking,Invoiced,Shipped,Delivered,Cancelled',
        size:      200,
      });
    } catch (err: any) {
      logger.error({ message: '[OrderSync] Trendyol API hatası', tenantId, err: err.message });
      throw err;
    }

    logger.info({ message: `[OrderSync] ${orders.length} sipariş alındı`, tenantId });

    let synced = 0, skipped = 0, errors = 0;
    const details: string[] = [];

    for (const raw of orders) {
      const orderNumber = String(raw.orderNumber ?? raw.id ?? '');
      if (!orderNumber) { errors++; continue; }

      try {
        const wasNew = await this.processOrder(tenantId, integration.id, raw);
        if (wasNew) {
          synced++;
          details.push(`✓ ${orderNumber}`);
        } else {
          skipped++;
        }
      } catch (err: any) {
        errors++;
        details.push(`✗ ${orderNumber}: ${err.message}`);
        logger.error({ message: '[OrderSync] Sipariş işleme hatası', tenantId, orderNumber, err: err.message });
      }
    }

    // lastOrderSync güncelle
    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { lastOrderSync: new Date() },
    });

    logger.info({ message: '[OrderSync] Tamamlandı', tenantId, synced, skipped, errors });

    return { synced, skipped, errors, details };
  }

  /**
   * Tek bir siparişi işler. Yeni ise true döner; zaten vardıysa false.
   */
  private async processOrder(tenantId: string, integrationId: string, raw: any): Promise<boolean> {
    const orderNumber = String(raw.orderNumber ?? raw.id ?? '');

    // Duplicate kontrolü — transaction öncesi hızlı kontrol
    const exists = await prisma.trendyolOrder.findUnique({
      where: { tenantId_orderNumber: { tenantId, orderNumber } },
      select: { id: true },
    });
    if (exists) return false;

    const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];

    // Batch barcode lookup (N+1 önleme)
    const barcodes = [...new Set(lines.map((l: any) => String(l.barcode ?? '')).filter(Boolean))];

    const [products, variants] = await Promise.all([
      prisma.product.findMany({
        where:  { tenantId, barcode: { in: barcodes } },
        select: { id: true, barcode: true },
      }),
      prisma.productVariant.findMany({
        where:  { barcode: { in: barcodes } },
        select: { id: true, barcode: true, productId: true },
      }),
    ]);

    const productByBarcode = new Map(products.map(p => [p.barcode!, p.id]));
    const variantByBarcode = new Map(variants.map(v => [v.barcode!, { variantId: v.id, productId: v.productId }]));

    await prisma.$transaction(async (tx) => {

      const newOrder = await tx.trendyolOrder.create({
        data: {
          tenantId,
          integrationId,
          orderNumber,
          status:              String(raw.status ?? 'Created'),
          totalPrice:          Number(raw.totalPrice ?? 0),
          orderDate:           raw.orderDate ? new Date(Number(raw.orderDate)) : new Date(),
          cargoTrackingNumber: raw.cargoTrackingNumber ?? null,
          customerFirstName:   raw.shipmentAddress?.firstName ?? raw.customerFirstName ?? null,
          customerLastName:    raw.shipmentAddress?.lastName  ?? raw.customerLastName  ?? null,
          customerEmail:       raw.customerEmail ?? null,
          shipmentAddress:     raw.shipmentAddress ?? null,
          invoiceAddress:      raw.invoiceAddress  ?? null,
          rawPayload:          raw,
        },
      });

      for (const line of lines) {
        const barcode    = String(line.barcode ?? '');
        const variantHit = variantByBarcode.get(barcode);
        const productId  = variantHit?.productId ?? productByBarcode.get(barcode) ?? null;
        const variantId  = variantHit?.variantId ?? null;
        const qty        = Math.max(1, Number(line.quantity ?? 1));

        await tx.trendyolOrderItem.create({
          data: {
            orderId:     newOrder.id,
            lineId:      line.id     != null ? String(line.id)  : null,
            barcode,
            productName: String(line.productName ?? line.productCode ?? ''),
            productId,
            variantId,
            quantity:    qty,
            price:       Number(line.price ?? line.amount ?? 0),
            merchantSku: line.merchantSku ?? null,
          },
        });

        // ── Stok düşme ───────────────────────────────────────────────────────
        if (variantId) {
          // Varyant stoğu düş, minimum 0'da tut
          const variant = await tx.productVariant.findUnique({
            where:  { id: variantId },
            select: { stockQuantity: true },
          });
          const newQty = Math.max(0, Number(variant?.stockQuantity ?? 0) - qty);
          await tx.productVariant.update({
            where: { id: variantId },
            data:  { stockQuantity: newQty },
          });
        } else if (productId) {
          // Stock tablosundan düş (minimum 0)
          const stockRow = await tx.stock.findUnique({
            where:  { productId },
            select: { quantity: true },
          });
          if (stockRow) {
            const newQty = Math.max(0, Number(stockRow.quantity) - qty);
            await tx.stock.update({
              where: { productId },
              data:  { quantity: newQty },
            });
          }
        }
      }

      await tx.trendyolOrder.update({
        where: { id: newOrder.id },
        data:  { stockDecremented: true },
      });
    });

    return true;
  }

  /**
   * Tüm aktif Trendyol entegrasyonlarını tarar (cron için).
   */
  async syncAllTenants(): Promise<void> {
    const integrations = await prisma.trendyolIntegration.findMany({
      where:  { isActive: true },
      select: { tenantId: true },
    });

    logger.info({ message: `[OrderSync Cron] ${integrations.length} tenant taranıyor` });

    for (const { tenantId } of integrations) {
      try {
        const result = await this.syncForTenant(tenantId);
        logger.info({ message: '[OrderSync Cron] Tenant tamamlandı', tenantId, ...result });
      } catch (err: any) {
        logger.error({ message: '[OrderSync Cron] Tenant hatası', tenantId, err: err.message });
      }
    }
  }
}

export const orderSyncService = new TrendyolOrderSyncService();
