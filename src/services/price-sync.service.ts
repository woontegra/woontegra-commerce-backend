import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { MarketplaceSyncFactory, StockSyncItem } from './marketplace-sync.service';

const prisma = new PrismaClient();

export interface PriceSyncItem {
  productId: string;
  sku?: string;
  barcode?: string;
  price: number;
  discountPrice?: number;
  marketplaceProductId?: string;
  marketplaceSku?: string;
}

export interface PriceSyncResult {
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

export interface PriceStrategy {
  mode: 'none' | 'percent' | 'fixed';
  value: number;
  currency: string;
  roundTo: number;
}

/**
 * Price Sync Service
 */
export class PriceSyncService {
  /**
   * Get products with pricing for sync
   */
  static async getPricedProducts(tenantId: string, productIds?: string[]): Promise<PriceSyncItem[]> {
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
      price: product.pricing?.salePrice || 0,
      discountPrice: product.pricing?.discountPrice || undefined,
      marketplaceProductId: product.marketplaceProductMaps[0]?.marketplaceProductId,
      marketplaceSku: product.marketplaceProductMaps[0]?.marketplaceSku,
    }));
  }

  /**
   * Apply price strategy
   */
  static applyPriceStrategy(basePrice: number, strategy: PriceStrategy): number {
    let finalPrice = basePrice;

    switch (strategy.mode) {
      case 'percent':
        finalPrice = basePrice * (1 + strategy.value / 100);
        break;
      case 'fixed':
        finalPrice = basePrice + strategy.value;
        break;
      case 'none':
      default:
        finalPrice = basePrice;
        break;
    }

    // Round to specified precision
    const factor = Math.pow(10, strategy.roundTo);
    finalPrice = Math.round(finalPrice * factor) / factor;

    return Math.max(0, finalPrice);
  }

  /**
   * Get marketplace price strategy
   */
  static async getMarketplacePriceStrategy(
    tenantId: string,
    marketplaceId: string
  ): Promise<PriceStrategy> {
    const marketplace = await prisma.marketplaceAccount.findFirst({
      where: {
        id: marketplaceId,
        tenantId,
        isActive: true,
      },
      select: {
        settings: true,
      },
    });

    const settings = marketplace?.settings as any;
    
    return {
      mode: settings?.priceStrategy?.mode || 'none',
      value: settings?.priceStrategy?.value || 0,
      currency: settings?.priceStrategy?.currency || 'TRY',
      roundTo: settings?.priceStrategy?.roundTo || 2,
    };
  }

  /**
   * Sync prices to all active marketplaces
   */
  static async syncAllMarketplaces(
    tenantId: string,
    productIds?: string[]
  ): Promise<PriceSyncResult[]> {
    const marketplaces = await prisma.marketplaceAccount.findMany({
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

    const results: PriceSyncResult[] = [];

    for (const marketplace of marketplaces) {
      try {
        const result = await this.syncMarketplace(tenantId, marketplace.id, productIds);
        results.push(result);
      } catch (error: any) {
        logger.error('[PriceSync] Marketplace sync failed', {
          tenantId,
          marketplaceId: marketplace.id,
          marketplaceName: marketplace.name,
          error: error.message,
        });

        results.push({
          marketplaceId: marketplace.id,
          marketplaceName: marketplace.name,
          total: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
          duration: 0,
        });
      }
    }

    return results;
  }

  /**
   * Sync prices to specific marketplace
   */
  static async syncMarketplace(
    tenantId: string,
    marketplaceId: string,
    productIds?: string[]
  ): Promise<PriceSyncResult> {
    const startTime = Date.now();

    // Get marketplace info
    const marketplace = await prisma.marketplaceAccount.findFirst({
      where: {
        id: marketplaceId,
        tenantId,
        isActive: true,
      },
    });

    if (!marketplace) {
      throw new Error('Marketplace not found or inactive');
    }

    // Get price strategy
    const priceStrategy = await this.getMarketplacePriceStrategy(tenantId, marketplaceId);

    // Get products
    const products = await this.getPricedProducts(tenantId, productIds);

    // Apply price strategy
    const pricedItems = products.map(product => {
      const finalPrice = this.applyPriceStrategy(product.price, priceStrategy);
      const finalDiscountPrice = product.discountPrice 
        ? this.applyPriceStrategy(product.discountPrice, priceStrategy)
        : undefined;

      return {
        ...product,
        price: finalPrice,
        discountPrice: finalDiscountPrice,
      };
    });

    // Create marketplace syncer
    const marketplaceConfig = {
      id: marketplace.id,
      name: marketplace.name,
      type: marketplace.type as any,
      isActive: marketplace.isActive,
      credentials: marketplace.credentials,
      settings: marketplace.settings,
    };

    const syncer = MarketplaceSyncFactory.createSyncer(marketplaceConfig, tenantId);

    // Convert to StockSyncItem format (reuse existing sync infrastructure)
    const stockSyncItems: StockSyncItem[] = pricedItems.map(item => ({
      productId: item.productId,
      sku: item.sku,
      barcode: item.barcode,
      quantity: 0, // Not used for price sync
      price: item.price,
      marketplaceProductId: item.marketplaceProductId,
      marketplaceSku: item.marketplaceSku,
    }));

    // Sync prices (reuse stock sync infrastructure)
    const result = await syncer.updateStock(stockSyncItems);

    logger.info('[PriceSync] Price sync completed', {
      tenantId,
      marketplaceId,
      marketplaceName: marketplace.name,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      duration: result.duration,
    });

    return {
      marketplaceId: marketplace.id,
      marketplaceName: marketplace.name,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors,
      duration: result.duration,
    };
  }

  /**
   * Real-time price update (triggered by price changes)
   */
  static async handlePriceChange(
    tenantId: string,
    productId: string,
    newPrice: number,
    oldPrice: number,
    newDiscountPrice?: number,
    oldDiscountPrice?: number
  ): Promise<void> {
    // Only sync if price actually changed
    if (newPrice === oldPrice && newDiscountPrice === oldDiscountPrice) {
      return;
    }

    logger.info('[PriceSync] Handling price change', {
      tenantId,
      productId,
      oldPrice,
      newPrice,
      oldDiscountPrice,
      newDiscountPrice,
    });

    try {
      await this.syncAllMarketplaces(tenantId, [productId]);
    } catch (error: any) {
      logger.error('[PriceSync] Real-time sync failed', {
        tenantId,
        productId,
        error: error.message,
      });
      // Don't throw error to avoid blocking price update
    }
  }

  /**
   * Bulk price update with sync
   */
  static async bulkUpdatePrices(
    tenantId: string,
    updates: Array<{
      productId: string;
      price: number;
      discountPrice?: number;
    }>
  ): Promise<void> {
    logger.info('[PriceSync] Starting bulk price update', {
      tenantId,
      updateCount: updates.length,
    });

    // Update prices in database
    await prisma.$transaction(
      updates.map(update => 
        prisma.productPricing.upsert({
          where: { productId: update.productId },
          create: {
            productId: update.productId,
            salePrice: update.price,
            discountPrice: update.discountPrice || null,
            vatRate: 18,
            currency: 'TRY',
          },
          update: {
            salePrice: update.price,
            discountPrice: update.discountPrice || null,
          },
        })
      )
    );

    // Sync to marketplaces
    const productIds = updates.map(u => u.productId);
    await this.syncAllMarketplaces(tenantId, productIds);

    logger.info('[PriceSync] Bulk price update completed', {
      tenantId,
      updateCount: updates.length,
    });
  }

  /**
   * Get price sync history
   */
  static async getPriceSyncHistory(
    tenantId: string,
    marketplaceId?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    history: Array<{
      id: string;
      tenantId: string;
      marketplaceId: string;
      marketplaceName: string;
      totalProducts: number;
      succeededProducts: number;
      failedProducts: number;
      duration: number;
      triggeredBy: string;
      createdAt: string;
    }>;
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    // TODO: Implement price sync history tracking
    // This would require a price sync history table

    return {
      history: [],
      pagination: {
        total: 0,
        page,
        limit,
        totalPages: 0,
      },
    };
  }
}

export const priceSyncService = PriceSyncService;
