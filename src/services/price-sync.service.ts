import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

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
  name: string;
  type: 'fixed' | 'percentage' | 'formula';
  value: number;
  minPrice?: number;
  maxPrice?: number;
}

export class PriceSyncService {
  /**
   * Sync prices to all marketplaces for a tenant
   */
  static async syncPricesToMarketplaces(
    tenantId: string,
    productIds?: string[],
    marketplaceIds?: string[]
  ): Promise<PriceSyncResult[]> {
    const startTime = Date.now();
    const results: PriceSyncResult[] = [];

    try {
      // Get active marketplaces
      const marketplaces = await prisma.marketplace.findMany({
        where: {
          tenantId,
          isActive: true,
          ...(marketplaceIds?.length && { id: { in: marketplaceIds } }),
        },
      });

      if (marketplaces.length === 0) {
        logger.warn('No active marketplaces found for price sync', { tenantId });
        return [];
      }

      // Get products with their marketplace mappings
      const products = await prisma.product.findMany({
        where: {
          tenantId,
          isActive: true,
          ...(productIds?.length && { id: { in: productIds } }),
        },
        include: {
          marketplaceMappings: true,
          prices: true,
        },
      });

      // Sync to each marketplace
      for (const marketplace of marketplaces) {
        const result = await this.syncToMarketplace(
          tenantId,
          marketplace,
          products
        );
        results.push(result);
      }

      const duration = Date.now() - startTime;
      logger.info(`Price sync completed for ${results.length} marketplaces`, {
        tenantId,
        duration,
      });

      return results;
    } catch (error) {
      logger.error('Price sync failed:', error);
      throw error;
    }
  }

  /**
   * Sync prices to a specific marketplace
   */
  private static async syncToMarketplace(
    tenantId: string,
    marketplace: any,
    products: any[]
  ): Promise<PriceSyncResult> {
    const startTime = Date.now();
    const errors: Array<{ productId: string; error: string }> = [];
    let succeeded = 0;

    try {
      for (const product of products) {
        try {
          // Get marketplace-specific pricing
          const basePrice = product.prices?.[0]?.amount || product.price || 0;
          const marketplacePrice = await this.calculateMarketplacePrice(
            product,
            marketplace,
            basePrice
          );

          // Update or create marketplace product
          const mapping = product.marketplaceMappings?.find(
            (m: any) => m.marketplaceId === marketplace.id
          );

          if (mapping) {
            await prisma.marketplaceProduct.update({
              where: { id: mapping.id },
              data: {
                price: marketplacePrice,
                updatedAt: new Date(),
              },
            });
          }

          succeeded++;
        } catch (error) {
          errors.push({
            productId: product.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return {
        marketplaceId: marketplace.id,
        marketplaceName: marketplace.name,
        total: products.length,
        succeeded,
        failed: errors.length,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      logger.error(`Price sync failed for marketplace ${marketplace.name}:`, error);
      return {
        marketplaceId: marketplace.id,
        marketplaceName: marketplace.name,
        total: products.length,
        succeeded,
        failed: products.length - succeeded,
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Calculate price for a specific marketplace
   */
  private static async calculateMarketplacePrice(
    product: any,
    marketplace: any,
    basePrice: number
  ): Promise<number> {
    // Get marketplace-specific pricing strategy
    const strategy = marketplace.priceStrategy || {};
    
    let finalPrice = basePrice;

    // Apply price adjustments
    if (strategy.type === 'percentage') {
      finalPrice = basePrice * (1 + strategy.value / 100);
    } else if (strategy.type === 'fixed') {
      finalPrice = basePrice + strategy.value;
    } else if (strategy.type === 'formula' && strategy.formula) {
      // Formula-based pricing (simplified)
      finalPrice = this.evaluateFormula(strategy.formula, basePrice);
    }

    // Apply min/max constraints
    if (strategy.minPrice !== undefined) {
      finalPrice = Math.max(finalPrice, strategy.minPrice);
    }
    if (strategy.maxPrice !== undefined) {
      finalPrice = Math.min(finalPrice, strategy.maxPrice);
    }

    return Math.round(finalPrice * 100) / 100; // Round to 2 decimals
  }

  /**
   * Evaluate a pricing formula
   */
  private static evaluateFormula(formula: string, basePrice: number): number {
    try {
      // Simple formula evaluation (for security, use a proper math parser in production)
      const sanitized = formula.replace(/[^0-9+\-*/.()x ]/g, '');
      const expression = sanitized.replace(/x/g, basePrice.toString());
      
      // eslint-disable-next-line no-eval
      return eval(expression);
    } catch (error) {
      logger.error('Formula evaluation failed:', error);
      return basePrice;
    }
  }

  /**
   * Bulk update prices with strategy
   */
  static async bulkUpdatePrices(
    tenantId: string,
    strategy: PriceStrategy,
    filters?: {
      categoryId?: string;
      brandId?: string;
      productIds?: string[];
    }
  ): Promise<{ updated: number; errors: string[] }> {
    try {
      const where: any = { tenantId, isActive: true };
      
      if (filters?.categoryId) {
        where.categoryId = filters.categoryId;
      }
      if (filters?.brandId) {
        where.brandId = filters.brandId;
      }
      if (filters?.productIds?.length) {
        where.id = { in: filters.productIds };
      }

      const products = await prisma.product.findMany({
        where,
        include: { prices: true },
      });

      const errors: string[] = [];
      let updated = 0;

      for (const product of products) {
        try {
          const basePrice = product.prices?.[0]?.amount || product.price || 0;
          const newPrice = this.applyPriceStrategy(basePrice, strategy);

          await prisma.productPrice.updateMany({
            where: { productId: product.id },
            data: { amount: newPrice },
          });

          updated++;
        } catch (error) {
          errors.push(`Failed to update ${product.id}: ${error}`);
        }
      }

      logger.info(`Bulk price update completed: ${updated} products`, {
        tenantId,
        strategy,
      });

      return { updated, errors };
    } catch (error) {
      logger.error('Bulk price update failed:', error);
      throw error;
    }
  }

  /**
   * Apply price strategy to base price
   */
  private static applyPriceStrategy(
    basePrice: number,
    strategy: PriceStrategy
  ): number {
    let newPrice = basePrice;

    switch (strategy.type) {
      case 'fixed':
        newPrice = basePrice + strategy.value;
        break;
      case 'percentage':
        newPrice = basePrice * (1 + strategy.value / 100);
        break;
      case 'formula':
        newPrice = this.evaluateFormula(strategy.value.toString(), basePrice);
        break;
    }

    // Apply constraints
    if (strategy.minPrice !== undefined) {
      newPrice = Math.max(newPrice, strategy.minPrice);
    }
    if (strategy.maxPrice !== undefined) {
      newPrice = Math.min(newPrice, strategy.maxPrice);
    }

    return Math.round(newPrice * 100) / 100;
  }
}

export default PriceSyncService;
