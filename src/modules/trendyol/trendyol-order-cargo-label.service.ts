import prisma from '../../config/database';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { decryptTrendyolCredentials } from '../../common/crypto/marketplace-credential.crypto';
import {
  extractCargoTrackingNumber,
  isPdfUrl,
  type CargoLabelRequestFormat,
} from './trendyol-order-cargo-label.util';

export type CargoLabelDeliveryType = 'pdf_url' | 'zpl' | 'pdf_base64';

export interface CargoLabelItemResult {
  format:  string;
  content: string;
  url?:    string;
}

export interface CargoLabelResult {
  requestedFormat: CargoLabelRequestFormat;
  deliveryType:    CargoLabelDeliveryType;
  cargoTrackingNumber: string;
  labels:          CargoLabelItemResult[];
}

async function loadCargoLabelClient(tenantId: string, orderId: string) {
  const order = await prisma.trendyolOrder.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) {
    throw Object.assign(new Error('Sipariş bulunamadı.'), { statusCode: 404 });
  }

  const cargoTrackingNumber = extractCargoTrackingNumber(order.cargoTrackingNumber, order.rawPayload);
  if (!cargoTrackingNumber) {
    throw Object.assign(
      new Error('Kargo takip numarası bulunamadı. Siparişi yeniden senkronize edin.'),
      { statusCode: 422 },
    );
  }

  const integration = await prisma.trendyolIntegration.findFirst({
    where: { tenantId, isActive: true },
  });
  if (!integration) {
    throw Object.assign(new Error('Aktif Trendyol entegrasyonu bulunamadı.'), { statusCode: 422 });
  }

  let creds;
  try {
    creds = decryptTrendyolCredentials(integration);
  } catch (err: any) {
    throw Object.assign(
      new Error(err.message ?? 'Trendyol entegrasyon kimlik bilgileri okunamadı.'),
      { statusCode: 500 },
    );
  }

  const client = new TrendyolClient({
    apiKey:    creds.apiKey,
    apiSecret: creds.apiSecret,
    sellerId:  creds.sellerId,
  });

  return { order, cargoTrackingNumber, client };
}

function normalizeLabelItems(
  items: Array<{ format: string; label: string }>,
): CargoLabelItemResult[] {
  return items.map((item) => {
    const label = item.label.trim();
    if (isPdfUrl(label) || /^https?:\/\//i.test(label)) {
      return { format: item.format, content: label, url: label };
    }
    return { format: item.format, content: label };
  });
}

function pickDeliveryType(labels: CargoLabelItemResult[]): CargoLabelDeliveryType {
  if (labels.some(l => l.url)) return 'pdf_url';
  if (labels.some(l => l.format.toUpperCase() === 'PDF' && l.content.startsWith('http'))) return 'pdf_url';
  if (labels.some(l => l.format.toUpperCase() === 'ZPL')) return 'zpl';
  if (labels.some(l => l.content.startsWith('%PDF'))) return 'pdf_base64';
  return 'zpl';
}

export class TrendyolOrderCargoLabelService {

  async getCargoLabel(
    tenantId: string,
    orderId: string,
    requestedFormat: CargoLabelRequestFormat,
  ): Promise<CargoLabelResult> {
    const { order, cargoTrackingNumber, client } = await loadCargoLabelClient(tenantId, orderId);

    const logBase = {
      cargoTrackingNumber,
      requestedFormat,
      orderNumber: order.orderNumber,
    };

    try {
      await client.createCommonLabel(cargoTrackingNumber);
    } catch {
      // create başarısız olsa bile GET denenebilir
    }

    let rawItems: Array<{ format: string; label: string }> = [];
    let fetchError: (Error & { statusCode?: number }) | null = null;

    if (requestedFormat === 'A4') {
      try {
        rawItems = await client.getCommonLabelQuery(cargoTrackingNumber);
      } catch (err: any) {
        fetchError = err;
      }
    }

    if (!rawItems.length) {
      try {
        rawItems = await client.getCommonLabel(cargoTrackingNumber);
        fetchError = null;
      } catch (err: any) {
        fetchError = err;
      }
    }

    if (!rawItems.length && fetchError) {
      await prisma.integrationLog.create({
        data: {
          tenantId,
          status:          'error',
          message:         `Kargo etiketi alma hatası: ${order.orderNumber} — ${fetchError.message}`,
          requestPayload:  logBase,
          responsePayload: { error: fetchError.message },
        },
      }).catch(() => {});
      throw fetchError;
    }

    if (!rawItems.length) {
      const err = Object.assign(
        new Error('Trendyol kargo etiketi döndürmedi. Birkaç saniye sonra tekrar deneyin.'),
        { statusCode: 422 },
      );
      await prisma.integrationLog.create({
        data: {
          tenantId,
          status:          'error',
          message:         `Kargo etiketi boş: ${order.orderNumber}`,
          requestPayload:  logBase,
          responsePayload: { error: err.message },
        },
      }).catch(() => {});
      throw err;
    }

    const labels       = normalizeLabelItems(rawItems);
    const deliveryType = pickDeliveryType(labels);

    await prisma.integrationLog.create({
      data: {
        tenantId,
        status:          'success',
        message:         `Kargo etiketi alındı (${requestedFormat}): ${order.orderNumber}`,
        requestPayload:  logBase,
        responsePayload: {
          deliveryType,
          labelCount: labels.length,
          formats:    labels.map(l => l.format),
        },
      },
    }).catch(() => {});

    return {
      requestedFormat,
      deliveryType,
      cargoTrackingNumber,
      labels,
    };
  }
}

export const trendyolOrderCargoLabelService = new TrendyolOrderCargoLabelService();
