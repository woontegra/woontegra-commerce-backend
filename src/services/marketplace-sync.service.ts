import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface MarketplaceConfig {
  id: string;
  name: string;
  type: 'TRENDYOL' | 'HEPSIBURADA' | 'N11' | 'AMAZON' | 'CUSTOM';
  isActive: boolean;
  credentials: any;
  settings: any;
}

export interface StockSyncItem {
  productId: string;
  sku?: string;
  barcode?: string;
  quantity: number;
  price?: number;
  marketplaceProductId?: string;
  marketplaceSku?: string;
}

export interface StockSyncResult {
  marketplaceId: string;
  marketplaceName: string;
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{
    productId: string;
    error: string;
  }>;
  duration: number;
}

export interface MarketplaceStockSyncer {
  updateStock(items: StockSyncItem[]): Promise<StockSyncResult>;
  testConnection(): Promise<boolean>;
  getMarketplaceInfo(): MarketplaceConfig;
}

/**
 * Abstract base class for marketplace stock synchronization
 */
export abstract class BaseMarketplaceSyncer implements MarketplaceStockSyncer {
  protected config: MarketplaceConfig;
  protected tenantId: string;

  constructor(config: MarketplaceConfig, tenantId: string) {
    this.config = config;
    this.tenantId = tenantId;
  }

  abstract updateStock(items: StockSyncItem[]): Promise<StockSyncResult>;
  abstract testConnection(): Promise<boolean>;

  getMarketplaceInfo(): MarketplaceConfig {
    return this.config;
  }

  protected createResult(
    total: number,
    succeeded: number,
    failed: number,
    errors: Array<{ productId: string; error: string }>,
    duration: number
  ): StockSyncResult {
    return {
      marketplaceId: this.config.id,
      marketplaceName: this.config.name,
      total,
      succeeded,
      failed,
      errors,
      duration,
    };
  }
}

/**
 * Trendyol Stock Sync Implementation
 */
export class TrendyolStockSyncer extends BaseMarketplaceSyncer {
  constructor(config: MarketplaceConfig, tenantId: string) {
    super(config, tenantId);
  }

  async updateStock(items: StockSyncItem[]): Promise<StockSyncResult> {
    const startTime = Date.now();
    const errors: Array<{ productId: string; error: string }> = [];
    let succeeded = 0;
    let failed = 0;

    logger.info('[TrendyolStockSync] Starting stock update', {
      tenantId: this.tenantId,
      itemCount: items.length,
    });

    // Import TrendyolClient dynamically to avoid circular dependencies
    const { TrendyolClient } = await import('../modules/marketplace/clients/trendyol.client');
    
    const client = new TrendyolClient({
      apiKey: this.config.credentials.apiKey,
      apiSecret: this.config.credentials.apiSecret,
      sellerId: this.config.credentials.supplierId,
    });

    // Process items in batches to avoid rate limits
    const batchSize = 100;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      for (const item of batch) {
        try {
          await this.updateSingleStock(client, item);
          succeeded++;
        } catch (error: any) {
          failed++;
          errors.push({
            productId: item.productId,
            error: error.message || 'Unknown error',
          });
          logger.error('[TrendyolStockSync] Item update failed', {
            productId: item.productId,
            error: error.message,
          });
        }
      }

      // Rate limiting - wait between batches
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const duration = Date.now() - startTime;

    logger.info('[TrendyolStockSync] Stock update completed', {
      tenantId: this.tenantId,
      total: items.length,
      succeeded,
      failed,
      duration,
    });

    return this.createResult(items.length, succeeded, failed, errors, duration);
  }

  private async updateSingleStock(client: any, item: StockSyncItem): Promise<void> {
    if (!item.marketplaceProductId && !item.barcode) {
      throw new Error('Marketplace product ID or barcode required');
    }

    // Find product on Trendyol
    let trendyolProduct: any;
    
    if (item.marketplaceProductId) {
      trendyolProduct = await client.getProduct(item.marketplaceProductId);
    } else if (item.barcode) {
      const searchResults = await client.searchProducts({ barcode: item.barcode });
      trendyolProduct = searchResults[0];
    }

    if (!trendyolProduct) {
      throw new Error('Product not found on Trendyol');
    }

    // Update stock and price
    const updateData: any = {
      quantity: item.quantity,
    };

    if (item.price !== undefined) {
      updateData.salePrice = item.price;
    }

    await client.updateProduct(trendyolProduct.id, updateData);

    logger.debug('[TrendyolStockSync] Product updated', {
      productId: item.productId,
      marketplaceProductId: trendyolProduct.id,
      quantity: item.quantity,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const { TrendyolClient } = await import('../modules/marketplace/clients/trendyol.client');
      
      const client = new TrendyolClient({
        apiKey: this.config.credentials.apiKey,
        apiSecret: this.config.credentials.apiSecret,
        sellerId: this.config.credentials.supplierId,
      });

      // Test by fetching seller info
      await client.getSellerInfo();
      return true;
    } catch (error) {
      logger.error('[TrendyolStockSync] Connection test failed', {
        tenantId: this.tenantId,
        error: error.message,
      });
      return false;
    }
  }
}

/**
 * Hepsiburada Stock Sync Implementation (Placeholder)
 */
export class HepsiburadaStockSyncer extends BaseMarketplaceSyncer {
  async updateStock(items: StockSyncItem[]): Promise<StockSyncResult> {
    // TODO: Implement Hepsiburada API integration
    logger.warn('[HepsiburadaStockSync] Not implemented yet', {
      tenantId: this.tenantId,
      itemCount: items.length,
    });

    return this.createResult(items.length, 0, items.length, 
      items.map(item => ({
        productId: item.productId,
        error: 'Hepsiburada integration not implemented',
      })),
      0
    );
  }

  async testConnection(): Promise<boolean> {
    // TODO: Implement Hepsiburada connection test
    return false;
  }
}

/**
 * N11 Stock Sync Implementation (Placeholder)
 */
export class N11StockSyncer extends BaseMarketplaceSyncer {
  async updateStock(items: StockSyncItem[]): Promise<StockSyncResult> {
    // TODO: Implement N11 API integration
    logger.warn('[N11StockSync] Not implemented yet', {
      tenantId: this.tenantId,
      itemCount: items.length,
    });

    return this.createResult(items.length, 0, items.length,
      items.map(item => ({
        productId: item.productId,
        error: 'N11 integration not implemented',
      })),
      0
    );
  }

  async testConnection(): Promise<boolean> {
    // TODO: Implement N11 connection test
    return false;
  }
}

/**
 * Marketplace Sync Factory
 */
export class MarketplaceSyncFactory {
  static createSyncer(
    marketplaceConfig: MarketplaceConfig,
    tenantId: string
  ): MarketplaceStockSyncer {
    switch (marketplaceConfig.type) {
      case 'TRENDYOL':
        return new TrendyolStockSyncer(marketplaceConfig, tenantId);
      case 'HEPSIBURADA':
        return new HepsiburadaStockSyncer(marketplaceConfig, tenantId);
      case 'N11':
        return new N11StockSyncer(marketplaceConfig, tenantId);
      default:
        throw new Error(`Unsupported marketplace type: ${marketplaceConfig.type}`);
    }
  }
}

/**
 * Main Stock Sync Service
 */
export class StockSyncService {
  /**
   * Get active marketplace integrations for tenant
   */
  static async getActiveMarketplaces(tenantId: string): Promise<MarketplaceConfig[]> {
    const integrations = await prisma.marketplaceAccount.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        credentials: true,
        settings: true,
      },
    });

    return integrations.map(integration => ({
      id: integration.id,
      name: integration.name,
      type: integration.type as any,
      isActive: integration.isActive,
      credentials: integration.credentials,
      settings: integration.settings,
    }));
  }

  /**
   * Get products with stock for sync
   */
  static async getStockProducts(tenantId: string, productIds?: string[]): Promise<StockSyncItem[]> {
    const whereClause: any = {
      tenantId,
      isActive: true,
    };

    if (productIds && productIds.length > 0) {
      whereClause.id = { in: productIds };
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        stock: true,
        pricing: true,
        marketplaceProductMaps: {
          where: {
            marketplace: {
              isActive: true,
            },
          },
        },
      },
    });

    return products.map(product => ({
      productId: product.id,
      sku: product.sku || undefined,
      barcode: product.barcode || undefined,
      quantity: product.stock?.quantity || 0,
      price: product.pricing?.salePrice || undefined,
      marketplaceProductId: product.marketplaceProductMaps[0]?.marketplaceProductId,
      marketplaceSku: product.marketplaceProductMaps[0]?.marketplaceSku,
    }));
  }

  /**
   * Sync stock to all active marketplaces
   */
  static async syncAllMarketplaces(
    tenantId: string,
    productIds?: string[]
  ): Promise<StockSyncResult[]> {
    const marketplaces = await this.getActiveMarketplaces(tenantId);
    const products = await this.getStockProducts(tenantId, productIds);

    logger.info('[StockSync] Starting marketplace sync', {
      tenantId,
      marketplaceCount: marketplaces.length,
      productCount: products.length,
    });

    const results: StockSyncResult[] = [];

    for (const marketplace of marketplaces) {
      try {
        const syncer = MarketplaceSyncFactory.createSyncer(marketplace, tenantId);
        const result = await syncer.updateStock(products);
        results.push(result);
      } catch (error: any) {
        logger.error('[StockSync] Marketplace sync failed', {
          tenantId,
          marketplaceId: marketplace.id,
          marketplaceName: marketplace.name,
          error: error.message,
        });

        results.push({
          marketplaceId: marketplace.id,
          marketplaceName: marketplace.name,
          total: products.length,
          succeeded: 0,
          failed: products.length,
          errors: products.map(product => ({
            productId: product.productId,
            error: error.message,
          })),
          duration: 0,
        });
      }
    }

    logger.info('[StockSync] Marketplace sync completed', {
      tenantId,
      resultCount: results.length,
      totalSucceeded: results.reduce((sum, r) => sum + r.succeeded, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
    });

    return results;
  }

  /**
   * Sync stock to specific marketplace
   */
  static async syncMarketplace(
    tenantId: string,
    marketplaceId: string,
    productIds?: string[]
  ): Promise<StockSyncResult> {
    const marketplaces = await this.getActiveMarketplaces(tenantId);
    const marketplace = marketplaces.find(m => m.id === marketplaceId);

    if (!marketplace) {
      throw new Error('Marketplace not found or inactive');
    }

    const products = await this.getStockProducts(tenantId, productIds);
    const syncer = MarketplaceSyncFactory.createSyncer(marketplace, tenantId);

    return await syncer.updateStock(products);
  }

  /**
   * Test marketplace connection
   */
  static async testConnection(tenantId: string, marketplaceId: string): Promise<boolean> {
    const marketplaces = await this.getActiveMarketplaces(tenantId);
    const marketplace = marketplaces.find(m => m.id === marketplaceId);

    if (!marketplace) {
      throw new Error('Marketplace not found or inactive');
    }

    const syncer = MarketplaceSyncFactory.createSyncer(marketplace, tenantId);
    return await syncer.testConnection();
  }

  /**
   * Real-time stock update (triggered by stock changes)
   */
  static async handleStockChange(
    tenantId: string,
    productId: string,
    newQuantity: number,
    oldQuantity: number
  ): Promise<void> {
    // Only sync if quantity actually changed
    if (newQuantity === oldQuantity) {
      return;
    }

    logger.info('[StockSync] Handling stock change', {
      tenantId,
      productId,
      oldQuantity,
      newQuantity,
    });

    try {
      const products = await this.getStockProducts(tenantId, [productId]);
      if (products.length === 0) {
        return;
      }

      await this.syncAllMarketplaces(tenantId, [productId]);
    } catch (error: any) {
      logger.error('[StockSync] Real-time sync failed', {
        tenantId,
        productId,
        error: error.message,
      });
      // Don't throw error to avoid blocking stock update
    }
  }
}

export const stockSyncService = StockSyncService;
