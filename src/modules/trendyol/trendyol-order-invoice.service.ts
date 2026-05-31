import prisma from '../../config/database';
import type { Prisma, TrendyolOrder, TrendyolOrderItem } from '@prisma/client';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { decryptTrendyolCredentials } from '../../common/crypto/marketplace-credential.crypto';
import { enrichTrendyolOrderDetail } from './trendyol-order-detail.presenter';
import { orderSyncService } from './trendyol-order-sync.service';
import {
  extractShipmentPackageId,
  isHttpsUrl,
  isValidPdfBuffer,
  MAX_TRENDYOL_INVOICE_FILE_BYTES,
  parseInvoiceDateTime,
} from './trendyol-order-invoice.util';

export interface SendInvoiceLinkInput {
  invoiceLink:       string;
  invoiceNumber?:    string;
  invoiceDateTime?:  string | number;
}

export interface UploadInvoiceFileInput {
  file: {
    buffer:       Buffer;
    originalname: string;
    mimetype:     string;
    size:         number;
  };
  invoiceNumber?:   string;
  invoiceDateTime?: string | number;
}

type OrderWithItems = TrendyolOrder & { items: TrendyolOrderItem[] };

type InvoiceContext = {
  order:               OrderWithItems;
  shipmentPackageId:   number;
  client:              TrendyolClient;
};

async function loadInvoiceContext(tenantId: string, orderId: string): Promise<InvoiceContext> {
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

  return { order, shipmentPackageId, client };
}

async function writeIntegrationLog(
  tenantId: string,
  status: 'success' | 'error',
  message: string,
  requestPayload: object,
  responsePayload?: object,
) {
  await prisma.integrationLog.create({
    data: {
      tenantId,
      status,
      message,
      requestPayload,
      responsePayload: responsePayload ?? {},
    },
  }).catch(() => {});
}

async function finalizeInvoiceSuccess(
  tenantId: string,
  order: OrderWithItems,
  rawPatch: Record<string, unknown>,
  logMessage: string,
  requestPayload: object,
) {
  await writeIntegrationLog(tenantId, 'success', logMessage, requestPayload, { ok: true });

  const prevRaw = (order.rawPayload && typeof order.rawPayload === 'object')
    ? order.rawPayload as Record<string, unknown>
    : {};
  const updatedPayload: Prisma.InputJsonValue = {
    ...prevRaw,
    ...rawPatch,
    invoiceStatus: typeof prevRaw.invoiceStatus === 'string' ? prevRaw.invoiceStatus : 'Uploaded',
  };
  await prisma.trendyolOrder.update({
    where: { id: order.id },
    data:  { rawPayload: updatedPayload },
  });

  orderSyncService.syncForTenant(tenantId).catch(() => {});

  const refreshed = await prisma.trendyolOrder.findFirst({
    where:   { id: order.id, tenantId },
    include: { items: true },
  });

  return enrichTrendyolOrderDetail(refreshed ?? order);
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

    const { order, shipmentPackageId, client } = await loadInvoiceContext(tenantId, orderId);

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
      await writeIntegrationLog(
        tenantId,
        'error',
        `Fatura linki hatası: ${order.orderNumber} — ${err.message}`,
        trendyolPayload,
        { error: err.message },
      );
      throw err;
    }

    return finalizeInvoiceSuccess(
      tenantId,
      order,
      {
        invoiceLink,
        ...(invoiceNumber ? { invoiceNumber } : {}),
      },
      `Fatura linki gönderildi: ${order.orderNumber}`,
      trendyolPayload,
    );
  }

  async uploadInvoiceFile(tenantId: string, orderId: string, input: UploadInvoiceFileInput) {
    const file = input.file;
    if (!file?.buffer?.length) {
      throw Object.assign(new Error('PDF fatura dosyası zorunludur.'), { statusCode: 400 });
    }
    if (file.mimetype !== 'application/pdf') {
      throw Object.assign(new Error('Sadece PDF dosyası yüklenebilir.'), { statusCode: 400 });
    }
    if (file.size > MAX_TRENDYOL_INVOICE_FILE_BYTES) {
      throw Object.assign(new Error('Fatura dosyası en fazla 10 MB olabilir.'), { statusCode: 400 });
    }
    if (!isValidPdfBuffer(file.buffer)) {
      throw Object.assign(new Error('Geçerli bir PDF dosyası değil.'), { statusCode: 400 });
    }

    const { order, shipmentPackageId, client } = await loadInvoiceContext(tenantId, orderId);

    const invoiceDateTime = parseInvoiceDateTime(input.invoiceDateTime);
    const invoiceNumber   = input.invoiceNumber?.trim() || undefined;

    const logPayload = {
      shipmentPackageId,
      fileName: file.originalname,
      fileSize: file.size,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(invoiceDateTime != null ? { invoiceDateTime } : {}),
    };

    const trendyolPayload = {
      shipmentPackageId,
      file: {
        buffer:       file.buffer,
        originalname: file.originalname,
        mimetype:     file.mimetype,
      },
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(invoiceDateTime != null ? { invoiceDateTime } : {}),
    };

    try {
      await client.uploadInvoiceFile(trendyolPayload);
    } catch (err: any) {
      await writeIntegrationLog(
        tenantId,
        'error',
        `Fatura PDF hatası: ${order.orderNumber} — ${err.message}`,
        logPayload,
        { error: err.message },
      );
      throw err;
    }

    return finalizeInvoiceSuccess(
      tenantId,
      order,
      {
        ...(invoiceNumber ? { invoiceNumber } : {}),
      },
      `Fatura PDF yüklendi: ${order.orderNumber}`,
      logPayload,
    );
  }
}

export const trendyolOrderInvoiceService = new TrendyolOrderInvoiceService();
