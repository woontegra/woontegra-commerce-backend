import prisma from '../../config/database';
import { TrendyolClient } from '../marketplace/clients/trendyol.client';
import { decryptTrendyolCredentials } from '../../common/crypto/marketplace-credential.crypto';
import {
  extractCargoTrackingNumber,
  extractCargoLabelOrderContext,
  isPdfUrl,
  sleep,
} from './trendyol-order-cargo-label.util';

export type CargoLabelDeliveryType = 'pdf_url' | 'zpl' | 'pdf_base64';

export interface CargoLabelItemResult {
  format:  string;
  content: string;
  url?:    string;
}

export interface CargoLabelResult {
  deliveryType:        CargoLabelDeliveryType;
  cargoTrackingNumber: string;
  cargoProviderName:   string | null;
  labels:              CargoLabelItemResult[];
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

  const cargoCtx = extractCargoLabelOrderContext(order.rawPayload, order.status);

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

  return { order, cargoTrackingNumber, cargoCtx, client };
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
  if (labels.some(l => l.content.startsWith('%PDF'))) return 'pdf_base64';
  return 'zpl';
}

function isMissingLabelError(err: unknown): boolean {
  const e = err as Error & { statusCode?: number; trendyolStatus?: number };
  return e.statusCode === 422 || e.trendyolStatus === 400 || e.trendyolStatus === 404;
}

async function fetchCommonLabelWithRetry(
  client: TrendyolClient,
  cargoTrackingNumber: string,
  afterCreate: boolean,
): Promise<Array<{ format: string; label: string }>> {
  const attempts = afterCreate ? 3 : 1;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const items = await client.getCommonLabel(cargoTrackingNumber);
      if (items.length) return items;
    } catch (err) {
      lastError = err;
      if (!isMissingLabelError(err)) throw err;
    }

    if (afterCreate && i < attempts - 1) {
      await sleep(2000);
    }
  }

  if (lastError) throw lastError;
  return [];
}

export class TrendyolOrderCargoLabelService {

  /**
   * Trendyol common-label akışı:
   * 1) getCommonLabel
   * 2) yoksa createCommonLabel (ZPL)
   * 3) tekrar getCommonLabel (+ kısa retry)
   */
  async getCargoLabel(tenantId: string, orderId: string): Promise<CargoLabelResult> {
    const { order, cargoTrackingNumber, cargoCtx, client } = await loadCargoLabelClient(tenantId, orderId);

    const logBase = {
      cargoTrackingNumber,
      orderNumber:       order.orderNumber,
      cargoProviderName: cargoCtx.cargoProviderName,
      orderStatus:       order.status,
    };

    let rawItems: Array<{ format: string; label: string }> = [];
    let created = false;

    try {
      rawItems = await fetchCommonLabelWithRetry(client, cargoTrackingNumber, false);
    } catch (err: any) {
      if (!isMissingLabelError(err)) {
        await this.logError(tenantId, order.orderNumber, logBase, err);
        throw err;
      }
    }

    if (!rawItems.length) {
      try {
        await client.createCommonLabel(cargoTrackingNumber);
        created = true;
      } catch (err: any) {
        await this.logError(tenantId, order.orderNumber, logBase, err);
        throw err;
      }

      await sleep(1500);

      try {
        rawItems = await fetchCommonLabelWithRetry(client, cargoTrackingNumber, true);
      } catch (err: any) {
        await this.logError(tenantId, order.orderNumber, { ...logBase, created }, err);
        throw err;
      }
    }

    if (!rawItems.length) {
      const err = Object.assign(
        new Error(
          created
            ? 'Etiket talebi oluşturuldu ancak Trendyol henüz ZPL etiket döndürmedi. Birkaç saniye sonra tekrar deneyin.'
            : 'Trendyol kargo etiketi döndürmedi. Siparişi senkronize edip tekrar deneyin.',
        ),
        { statusCode: 422 },
      );
      await this.logError(tenantId, order.orderNumber, { ...logBase, created }, err);
      throw err;
    }

    const labels       = normalizeLabelItems(rawItems);
    const deliveryType = pickDeliveryType(labels);

    await prisma.integrationLog.create({
      data: {
        tenantId,
        status:          'success',
        message:         `Kargo etiketi alındı (ZPL): ${order.orderNumber}`,
        requestPayload:  { ...logBase, created },
        responsePayload: {
          deliveryType,
          labelCount: labels.length,
          formats:    labels.map(l => l.format),
        },
      },
    }).catch(() => {});

    return {
      deliveryType,
      cargoTrackingNumber,
      cargoProviderName: cargoCtx.cargoProviderName,
      labels,
    };
  }

  private async logError(
    tenantId: string,
    orderNumber: string,
    requestPayload: object,
    err: any,
  ) {
    await prisma.integrationLog.create({
      data: {
        tenantId,
        status:          'error',
        message:         `Kargo etiketi hatası: ${orderNumber} — ${err.message}`,
        requestPayload,
        responsePayload: {
          error:          err.message,
          trendyolStatus: err.trendyolStatus ?? null,
        },
      },
    }).catch(() => {});
  }
}

export const trendyolOrderCargoLabelService = new TrendyolOrderCargoLabelService();
