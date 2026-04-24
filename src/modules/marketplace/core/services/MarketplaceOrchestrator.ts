/**
 * MarketplaceOrchestrator
 *
 * Tüm pazaryeri operasyonları için tek giriş noktası.
 * Switch-case yok. Provider-specific kod yok.
 * Sadece Factory → Interface → işlem.
 *
 * Multi-tenant: tenantId her işlemde zorunludur.
 */

import prisma from '../../../../config/database';
import { logger } from '../../../../config/logger';
import { getMarketplaceProvider, KNOWN_MARKETPLACE_SLUGS } from '../../factory/MarketplaceFactory';
import {
  IMarketplaceProvider,
  ProviderConfig,
  NormalizedProduct,
  StockPriceItem,
  FetchOrdersOptions,
  SendResult,
  UpdateResult,
  ConnectionTestResult,
  NormalizedOrder,
} from '../interfaces/IMarketplaceProvider';

// ─── Credential helpers ───────────────────────────────────────────────────────

/**
 * MarketplaceAccount tablosundan credentials okur.
 * Trendyol entegrasyonu için TrendyolIntegration'dan da fallback yapar.
 */
async function resolveCredentials(tenantId: string, slug: string): Promise<ProviderConfig> {
  const normalizedSlug = slug.toLowerCase();

  // Önce genel MarketplaceAccount tablosuna bak
  const account = await (prisma as any).marketplaceAccount?.findFirst({
    where: {
      tenantId,
      provider: normalizedSlug.toUpperCase(),
      isActive: true,
    },
  }).catch(() => null);

  if (account) {
    return {
      tenantId,
      credentials: {
        apiKey:    account.apiKey,
        apiSecret: account.apiSecret,
        sellerId:  account.sellerId,
        extra:     account.extraData ?? undefined,
      },
    };
  }

  // Trendyol için eski TrendyolIntegration tablosuna fallback
  if (normalizedSlug === 'trendyol') {
    const integration = await prisma.trendyolIntegration.findFirst({
      where:  { tenantId, isActive: true },
      select: { apiKey: true, apiSecret: true, supplierId: true },
    });

    if (!integration) {
      throw new Error('Aktif Trendyol entegrasyonu bulunamadı. Lütfen API bilgilerini girin.');
    }

    return {
      tenantId,
      credentials: {
        apiKey:    integration.apiKey,
        apiSecret: integration.apiSecret,
        sellerId:  integration.supplierId,
      },
    };
  }

  throw new Error(`${slug} entegrasyonu için kimlik bilgisi bulunamadı.`);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class MarketplaceOrchestrator {

  /** Tüm bilinen pazaryeri slug'ları */
  get availableSlugs(): string[] {
    return KNOWN_MARKETPLACE_SLUGS;
  }

  /**
   * Belirtilen slug için provider instance döner.
   * Calling code asla provider'ı doğrudan yaratmaz.
   */
  private async provider(tenantId: string, slug: string): Promise<IMarketplaceProvider> {
    const config = await resolveCredentials(tenantId, slug);
    return getMarketplaceProvider(slug, config);
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async testConnection(tenantId: string, slug: string): Promise<ConnectionTestResult> {
    const p = await this.provider(tenantId, slug);
    logger.info({ message: `[Orchestrator] testConnection`, tenantId, slug });
    return p.testConnection();
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async sendProducts(
    tenantId: string,
    slug:     string,
    products: NormalizedProduct[],
  ): Promise<SendResult> {
    const p = await this.provider(tenantId, slug);
    logger.info({ message: `[Orchestrator] sendProducts`, tenantId, slug, count: products.length });
    return p.sendProducts(products);
  }

  // ── Stock & Price ──────────────────────────────────────────────────────────

  async updateStockAndPrice(
    tenantId: string,
    slug:     string,
    items:    StockPriceItem[],
  ): Promise<UpdateResult> {
    const p = await this.provider(tenantId, slug);
    logger.info({ message: `[Orchestrator] updateStockAndPrice`, tenantId, slug, count: items.length });
    return p.updateStockAndPrice(items);
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async fetchOrders(
    tenantId: string,
    slug:     string,
    opts?:    FetchOrdersOptions,
  ): Promise<NormalizedOrder[]> {
    const p = await this.provider(tenantId, slug);
    logger.info({ message: `[Orchestrator] fetchOrders`, tenantId, slug });
    return p.fetchOrders(opts);
  }

  /**
   * Tüm aktif pazaryerleri için sipariş sync (cron kullanır).
   * Her pazaryeri-tenant kombinasyonu için ayrı çalışır.
   */
  async syncAllOrders(): Promise<void> {
    // Trendyol için mevcut TrendyolIntegration tablosunu kullan
    const trendyolIntegrations = await prisma.trendyolIntegration.findMany({
      where:  { isActive: true },
      select: { tenantId: true },
    });

    for (const { tenantId } of trendyolIntegrations) {
      try {
        const orders = await this.fetchOrders(tenantId, 'trendyol', {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          status:    'Created,Picking,Invoiced,Shipped,Delivered,Cancelled',
        });

        logger.info({
          message: `[Orchestrator] syncAllOrders trendyol`,
          tenantId,
          count:   orders.length,
        });

        // Sipariş kayıt işi trendyol-order-sync.service tarafından halledilir.
        // Bu metod sadece provider-agnostic çekme katmanıdır.
      } catch (err: any) {
        logger.error({
          message:  `[Orchestrator] syncAllOrders hata`,
          tenantId,
          slug:     'trendyol',
          err:      err.message,
        });
      }
    }
  }

  /**
   * Tüm aktif pazaryerleri için stok/fiyat sync (cron kullanır).
   * `items` zaten TrendyolSyncQueue tarafından hazırlanır; bu metod sadece iletir.
   */
  async syncStockAndPrice(
    tenantId: string,
    slug:     string,
    items:    StockPriceItem[],
  ): Promise<UpdateResult> {
    try {
      return await this.updateStockAndPrice(tenantId, slug, items);
    } catch (err: any) {
      logger.error({
        message: `[Orchestrator] syncStockAndPrice hata`,
        tenantId, slug, err: err.message,
      });
      return { success: false, failed: items.length, errors: [{ message: err.message }] };
    }
  }
}

// Singleton — tüm uygulama bu instance'ı kullanır
export const orchestrator = new MarketplaceOrchestrator();
