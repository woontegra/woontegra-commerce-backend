import prisma from '../../config/database';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { logger } from '../../config/logger';
import { decryptTrendyolCredentials } from '../../common/crypto/marketplace-credential.crypto';
import type { TrendyolOrder, Prisma } from '@prisma/client';

export interface OrderSyncResult {
  /** Geriye dönük uyumluluk — createdCount ile aynı */
  synced:        number;
  createdCount:  number;
  updatedCount:  number;
  skippedCount:  number;
  errors:        number;
  errorCount:    number;
  details:       string[];
}

type OrderProcessOutcome = 'created' | 'updated' | 'unchanged';

type OrderHeaderData = {
  integrationId:       string;
  status:              string;
  totalPrice:          number;
  orderDate:           Date;
  cargoTrackingNumber: string | null;
  customerFirstName:   string | null;
  customerLastName:    string | null;
  customerEmail:       string | null;
  shipmentAddress:     Prisma.InputJsonValue;
  invoiceAddress:      Prisma.InputJsonValue;
  rawPayload:          Prisma.InputJsonValue;
};

export class TrendyolOrderSyncService {

  /**
   * Belirli bir tenant için Trendyol siparişlerini çeker ve kayıt eder.
   * - Son sync zamanından (lastOrderSync) itibaren ya da son 7 günü alır
   * - Benzersiz anahtar: @@unique([tenantId, orderNumber])
   * - Mevcut siparişlerde header alanları upsert edilir (stok tekrar düşülmez)
   * - Yeni siparişlerde barkod eşleştirme + stok düşme
   */
  async syncForTenant(tenantId: string): Promise<OrderSyncResult> {
    const integration = await prisma.trendyolIntegration.findFirst({
      where: { tenantId, isActive: true },
    });

    if (!integration) throw new Error('Aktif Trendyol entegrasyonu bulunamadı.');

    const creds = decryptTrendyolCredentials(integration);
    const client = new TrendyolClient({
      apiKey:    creds.apiKey,
      apiSecret: creds.apiSecret,
      sellerId:  creds.sellerId,
    });

    const sinceMs = integration.lastOrderSync
      ? integration.lastOrderSync.getTime() - 5 * 60 * 1000
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

    let createdCount = 0, updatedCount = 0, skippedCount = 0, errorCount = 0;
    const details: string[] = [];

    for (const raw of orders) {
      const orderNumber = String(raw.orderNumber ?? raw.id ?? '');
      if (!orderNumber) { errorCount++; continue; }

      try {
        const outcome = await this.processOrder(tenantId, integration.id, raw);
        if (outcome === 'created') {
          createdCount++;
          details.push(`+ ${orderNumber}`);
        } else if (outcome === 'updated') {
          updatedCount++;
          details.push(`↻ ${orderNumber}`);
        } else {
          skippedCount++;
        }
      } catch (err: any) {
        errorCount++;
        details.push(`✗ ${orderNumber}: ${err.message}`);
        logger.error({ message: '[OrderSync] Sipariş işleme hatası', tenantId, orderNumber, err: err.message });
      }
    }

    await prisma.trendyolIntegration.update({
      where: { id: integration.id },
      data:  { lastOrderSync: new Date() },
    });

    logger.info({
      message: '[OrderSync] Tamamlandı',
      tenantId,
      createdCount,
      updatedCount,
      skippedCount,
      errorCount,
    });

    return {
      synced:       createdCount,
      createdCount,
      updatedCount,
      skippedCount,
      errors:       errorCount,
      errorCount,
      details,
    };
  }

  private buildOrderHeader(integrationId: string, raw: any): OrderHeaderData {
    return {
      integrationId,
      status:              String(raw.status ?? raw.shipmentPackageStatus ?? 'Created'),
      totalPrice:          Number(raw.packageTotalPrice ?? raw.totalPrice ?? 0),
      orderDate:           raw.orderDate
        ? new Date(Number(raw.orderDate))
        : raw.lastModifiedDate
          ? new Date(Number(raw.lastModifiedDate))
          : new Date(),
      cargoTrackingNumber: this.extractCargoTrackingNumber(raw),
      customerFirstName:   raw.shipmentAddress?.firstName ?? raw.customerFirstName ?? null,
      customerLastName:    raw.shipmentAddress?.lastName  ?? raw.customerLastName  ?? null,
      customerEmail:       raw.customerEmail ?? null,
      shipmentAddress:     raw.shipmentAddress ?? null,
      invoiceAddress:      raw.invoiceAddress  ?? null,
      rawPayload:          raw,
    };
  }

  /** Trendyol yanıtından kargo takip no — paket seviyesi alanları dahil. */
  private extractCargoTrackingNumber(raw: any): string | null {
    const candidates = [
      raw.cargoTrackingNumber,
      raw.trackingNumber,
      raw.shipmentPackage?.cargoTrackingNumber,
      Array.isArray(raw.shipmentPackages) ? raw.shipmentPackages[0]?.cargoTrackingNumber : null,
      Array.isArray(raw.packages) ? raw.packages[0]?.cargoTrackingNumber : null,
    ];
    for (const c of candidates) {
      if (c != null && String(c).trim()) return String(c).trim();
    }
    return null;
  }

  private orderHeaderChanged(existing: TrendyolOrder, next: OrderHeaderData): boolean {
    if (existing.status !== next.status) return true;
    if (String(existing.cargoTrackingNumber ?? '') !== String(next.cargoTrackingNumber ?? '')) return true;
    if (Number(existing.totalPrice) !== next.totalPrice) return true;
    if (String(existing.customerFirstName ?? '') !== String(next.customerFirstName ?? '')) return true;
    if (String(existing.customerLastName ?? '')  !== String(next.customerLastName ?? ''))  return true;
    if (String(existing.customerEmail ?? '')     !== String(next.customerEmail ?? ''))     return true;
    if (JSON.stringify(existing.shipmentAddress ?? null) !== JSON.stringify(next.shipmentAddress ?? null)) return true;
    if (JSON.stringify(existing.invoiceAddress ?? null)  !== JSON.stringify(next.invoiceAddress ?? null))  return true;

    const prevStatus = (existing.rawPayload as Record<string, unknown> | null)?.status;
    const nextStatus = (next.rawPayload as Record<string, unknown> | null)?.status;
    if (String(prevStatus ?? '') !== String(nextStatus ?? '')) return true;

    const prevCargo = (existing.rawPayload as Record<string, unknown> | null)?.cargoTrackingNumber;
    if (String(prevCargo ?? '') !== String(next.cargoTrackingNumber ?? '')) return true;

    return false;
  }

  /**
   * Tek bir siparişi işler.
   * Yeni: create + stok düş. Mevcut: header upsert (kalemler/stok dokunulmaz).
   */
  private async processOrder(tenantId: string, integrationId: string, raw: any): Promise<OrderProcessOutcome> {
    const orderNumber = String(raw.orderNumber ?? raw.id ?? '');
    const header = this.buildOrderHeader(integrationId, raw);

    const existing = await prisma.trendyolOrder.findUnique({
      where: { tenantId_orderNumber: { tenantId, orderNumber } },
    });

    if (existing) {
      if (!this.orderHeaderChanged(existing, header)) {
        return 'unchanged';
      }

      await prisma.trendyolOrder.update({
        where: { id: existing.id },
        data: {
          integrationId:       header.integrationId,
          status:              header.status,
          totalPrice:          header.totalPrice,
          cargoTrackingNumber: header.cargoTrackingNumber,
          customerFirstName:   header.customerFirstName,
          customerLastName:    header.customerLastName,
          customerEmail:       header.customerEmail,
          shipmentAddress:     header.shipmentAddress,
          invoiceAddress:      header.invoiceAddress,
          rawPayload:          header.rawPayload,
        },
      });

      return 'updated';
    }

    const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];
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
          integrationId:       header.integrationId,
          orderNumber,
          status:              header.status,
          totalPrice:          header.totalPrice,
          orderDate:           header.orderDate,
          cargoTrackingNumber: header.cargoTrackingNumber,
          customerFirstName:   header.customerFirstName,
          customerLastName:    header.customerLastName,
          customerEmail:       header.customerEmail,
          shipmentAddress:     header.shipmentAddress,
          invoiceAddress:      header.invoiceAddress,
          rawPayload:          header.rawPayload,
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
            lineId:      line.id != null ? String(line.id) : null,
            barcode,
            productName: String(line.productName ?? line.productCode ?? ''),
            productId,
            variantId,
            quantity:    qty,
            price:       Number(line.price ?? line.amount ?? 0),
            merchantSku: line.merchantSku ?? null,
          },
        });

        if (variantId) {
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

    return 'created';
  }

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
