import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { decryptTrendyolCredentials } from '../../common/crypto/marketplace-credential.crypto';
import { enrichTrendyolOrderDetail } from './trendyol-order-detail.presenter';
import { orderSyncService } from './trendyol-order-sync.service';
import {
  extractShipmentPackageId,
  isHttpsUrl,
  parseInvoiceDateTime,
} from './trendyol-order-invoice.util';

export interface SendInvoiceLinkInput {
  invoiceLink:       string;
  invoiceNumber?:    string;
  invoiceDateTime?:  string | number;
}

export class TrendyolOrderInvoiceService {

  async sendInvoiceLink(tenantId: string, orderId: string, input: SendInvoiceLinkInput) {
    const invoiceLink = input.invoiceLink?.trim();
    if (!invoiceLink) {
      throw Object.assign(new Error('Fatura linki zorunludur.'), { statusCode: 400 });
    }
    if (!isHttpsUrl(invoiceLink)) {
      throw Object.assign(new Error('Fatura linki HTTPS olmalıdır.'), { statusCode: 400 });
    }

    const order = await prisma.trendyolOrder.findFirst({
      where:   { id: orderId, tenantId },
      include: { items: true },
    });
    if (!order) {
      throw Object.assign(new Error('Sipariş bulunamadı.'), { statusCode: 404 });
    }

    const shipmentPackageId = extractShipmentPackageId(order.rawPayload);
    if (!shipmentPackageId) {
      throw Object.assign(
        new Error(
          'Bu sipariş için Trendyol paket kimliği (shipmentPackageId) bulunamadı. '
          + 'Siparişi yeniden senkronize edip tekrar deneyin.',
        ),
        { statusCode: 422 },
      );
    }

    const integration = await prisma.trendyolIntegration.findFirst({
      where: { tenantId, isActive: true },
    });
    if (!integration) {
      throw Object.assign(new Error('Aktif Trendyol entegrasyonu bulunamadı.'), { statusCode: 422 });
    }

    const creds  = decryptTrendyolCredentials(integration);
    const client = new TrendyolClient({
      apiKey:    creds.apiKey,
      apiSecret: creds.apiSecret,
      sellerId:  creds.sellerId,
    });

    const invoiceDateTime = parseInvoiceDateTime(input.invoiceDateTime);
    const invoiceNumber   = input.invoiceNumber?.trim() || undefined;

    const trendyolPayload = {
      shipmentPackageId,
      invoiceLink,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(invoiceDateTime != null ? { invoiceDateTime } : {}),
    };

    try {
      await client.sendInvoiceLink(trendyolPayload);
    } catch (err: any) {
      await prisma.integrationLog.create({
        data: {
          tenantId,
          status:          'error',
          message:         `Fatura linki hatası: ${order.orderNumber} — ${err.message}`,
          requestPayload:  trendyolPayload as object,
          responsePayload: { error: err.message },
        },
      }).catch(() => {});
      throw err;
    }

    await prisma.integrationLog.create({
      data: {
        tenantId,
        status:          'success',
        message:         `Fatura linki gönderildi: ${order.orderNumber}`,
        requestPayload:  trendyolPayload as object,
        responsePayload: { ok: true },
      },
    }).catch(() => {});

    // rawPayload fatura alanlarını güncelle (sync gelene kadar UI)
    const prevRaw = (order.rawPayload && typeof order.rawPayload === 'object')
      ? order.rawPayload as Record<string, unknown>
      : {};
    const updatedPayload: Prisma.InputJsonValue = {
      ...prevRaw,
      invoiceLink,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      invoiceStatus: typeof prevRaw.invoiceStatus === 'string' ? prevRaw.invoiceStatus : 'Uploaded',
    };
    await prisma.trendyolOrder.update({
      where: { id: order.id },
      data:  { rawPayload: updatedPayload },
    });

    // Arka planda tam sync — cron'a dokunmadan mevcut servis
    orderSyncService.syncForTenant(tenantId).catch(() => {});

    const refreshed = await prisma.trendyolOrder.findFirst({
      where:   { id: order.id, tenantId },
      include: { items: true },
    });

    return enrichTrendyolOrderDetail(refreshed ?? order);
  }
}

export const trendyolOrderInvoiceService = new TrendyolOrderInvoiceService();
