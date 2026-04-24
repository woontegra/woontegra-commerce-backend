/**
 * TrendyolProvider
 *
 * IMarketplaceProvider implementasyonu — mevcut TrendyolClient'ı wrap eder.
 * Trendyol-specific API detayları burada kalır; core katmanı hiçbir şey bilmez.
 */

import {
  IMarketplaceProvider,
  ProviderConfig,
  NormalizedProduct,
  NormalizedVariant,
  NormalizedOrder,
  NormalizedOrderItem,
  StockPriceItem,
  SendResult,
  UpdateResult,
  FetchOrdersOptions,
  ConnectionTestResult,
} from '../../core/interfaces/IMarketplaceProvider';
import { TrendyolClient } from '../../clients/trendyol.client';
import { logger } from '../../../../config/logger';

export class TrendyolProvider implements IMarketplaceProvider {
  readonly name = 'Trendyol';

  private client: TrendyolClient;
  private readonly tenantId: string;

  constructor(config: ProviderConfig) {
    this.tenantId = config.tenantId;
    this.client   = new TrendyolClient({
      apiKey:    config.credentials.apiKey,
      apiSecret: config.credentials.apiSecret,
      sellerId:  config.credentials.sellerId,
    });
  }

  // ── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const ok = await this.client.healthCheck();
      return { ok, latencyMs: Date.now() - start };
    } catch (err: any) {
      return {
        ok:      false,
        message: err?.trendyolMessage ?? err?.message ?? 'Bağlantı hatası',
        latencyMs: Date.now() - start,
      };
    }
  }

  // ── Send products ──────────────────────────────────────────────────────────

  async sendProducts(products: NormalizedProduct[]): Promise<SendResult> {
    if (products.length === 0) {
      return { success: true, sentCount: 0, failedCount: 0 };
    }

    try {
      // Build Trendyol payload
      const items = products.map(p => this._buildTrendyolItem(p));

      const result = await this.client.createProduct({ items });

      logger.info({
        message:  '[TrendyolProvider] sendProducts',
        tenantId: this.tenantId,
        count:    products.length,
        batchId:  result?.batchRequestId,
      });

      return {
        success:   true,
        batchId:   result?.batchRequestId ?? null,
        sentCount: products.length,
        rawResponse: result,
      };
    } catch (err: any) {
      const message = err?.trendyolMessage ?? err?.message ?? 'Bilinmeyen hata';
      logger.error({
        message:  '[TrendyolProvider] sendProducts hata',
        tenantId: this.tenantId,
        err:      message,
      });
      return {
        success:    false,
        sentCount:  0,
        failedCount: products.length,
        errors: [{ message }],
      };
    }
  }

  // ── Stock & price update ───────────────────────────────────────────────────

  async updateStockAndPrice(items: StockPriceItem[]): Promise<UpdateResult> {
    if (items.length === 0) return { success: true, updated: 0 };

    try {
      await this.client.updateStockAndPrice(
        items.map(i => ({
          barcode:   i.barcode,
          quantity:  i.quantity,
          price:     i.salePrice,
          listPrice: i.listPrice,
        })),
      );

      logger.info({
        message:  '[TrendyolProvider] updateStockAndPrice',
        tenantId: this.tenantId,
        count:    items.length,
      });

      return { success: true, updated: items.length };
    } catch (err: any) {
      const message = err?.trendyolMessage ?? err?.message ?? 'Bilinmeyen hata';
      logger.error({
        message:  '[TrendyolProvider] updateStockAndPrice hata',
        tenantId: this.tenantId,
        err:      message,
      });
      return {
        success: false,
        failed:  items.length,
        errors:  [{ message }],
      };
    }
  }

  // ── Fetch orders ───────────────────────────────────────────────────────────

  async fetchOrders(opts?: FetchOrdersOptions): Promise<NormalizedOrder[]> {
    try {
      const rawOrders = await this.client.getOrders({
        startDate: opts?.startDate?.getTime(),
        endDate:   opts?.endDate?.getTime(),
        status:    opts?.status ?? 'Created,Picking,Invoiced,Shipped,Delivered,Cancelled',
        page:      opts?.page  ?? 0,
        size:      opts?.size  ?? 200,
      });

      return rawOrders.map(raw => this._normalizeOrder(raw));
    } catch (err: any) {
      const message = err?.trendyolMessage ?? err?.message ?? 'Sipariş çekme hatası';
      logger.error({
        message:  '[TrendyolProvider] fetchOrders hata',
        tenantId: this.tenantId,
        err:      message,
      });
      throw new Error(`Trendyol sipariş çekme hatası: ${message}`);
    }
  }

  // ── Private: payload builders ──────────────────────────────────────────────

  private _buildTrendyolItem(p: NormalizedProduct): Record<string, any> {
    const base: Record<string, any> = {
      barcode:          p.barcode,
      title:            p.title,
      productMainId:    p.barcode,
      brandId:          Number(p.brandId),
      categoryId:       Number(p.categoryId),
      quantity:         p.quantity,
      stockCode:        p.barcode,
      dimensionalWeight: 1,
      description:      p.description,
      currencyType:     p.currency ?? 'TRY',
      listPrice:        p.listPrice,
      salePrice:        p.price,
      vatRate:          p.vatRate ?? 18,
      cargoCompanyId:   p.cargoCompanyId ?? 10,
      images:           p.images.map(url => ({ url })),
      attributes:       this._mapAttributes(p.attributes),
    };

    if (p.deliveryDuration != null) {
      base.deliveryDuration = p.deliveryDuration;
    }

    return base;
  }

  private _mapAttributes(attrs: Record<string, any>): Array<{ attributeId: number; attributeValueId?: number; customAttributeValue?: string }> {
    return Object.entries(attrs)
      .filter(([, v]) => v !== '' && v != null)
      .map(([id, value]) => {
        const attrId = Number(id);
        if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
          return { attributeId: attrId, attributeValueId: Number(value) };
        }
        return { attributeId: attrId, customAttributeValue: String(value) };
      });
  }

  private _normalizeOrder(raw: any): NormalizedOrder {
    const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];

    const items: NormalizedOrderItem[] = lines.map(l => ({
      externalLineId: l.id != null ? String(l.id) : undefined,
      barcode:        String(l.barcode ?? ''),
      productName:    String(l.productName ?? l.productCode ?? ''),
      quantity:       Math.max(1, Number(l.quantity ?? 1)),
      price:          Number(l.price ?? l.amount ?? 0),
      merchantSku:    l.merchantSku ?? undefined,
    }));

    return {
      externalId:          String(raw.orderNumber ?? raw.id ?? ''),
      status:              String(raw.status ?? 'Created'),
      totalPrice:          Number(raw.totalPrice ?? 0),
      currency:            'TRY',
      orderDate:           raw.orderDate ? new Date(Number(raw.orderDate)) : new Date(),
      customerName:        [raw.shipmentAddress?.firstName, raw.shipmentAddress?.lastName].filter(Boolean).join(' ') || raw.customerName || null,
      customerEmail:       raw.customerEmail ?? null,
      shipmentAddress:     raw.shipmentAddress ?? null,
      invoiceAddress:      raw.invoiceAddress  ?? null,
      cargoTrackingNumber: raw.cargoTrackingNumber ?? null,
      items,
      rawPayload:          raw,
    };
  }
}
