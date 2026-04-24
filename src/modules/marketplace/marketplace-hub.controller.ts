import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { priceSyncService } from '../../services/price-sync.service';
import { stockSyncService } from '../../services/marketplace-sync.service';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class MarketplaceHubController {
  /**
   * Get marketplace dashboard overview
   */
  async getDashboard(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Get active marketplaces
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
          createdAt: true,
          _count: {
            select: {
              marketplaceProductMaps: true,
            },
          },
        },
      });

      // Get sync statistics
      const totalProducts = await prisma.product.count({
        where: {
          tenantId,
          isActive: true,
        },
      });

      const mappedProducts = await prisma.marketplaceProductMap.count({
        where: {
          product: {
            tenantId,
          },
          marketplace: {
            isActive: true,
          },
        },
      });

      // Get recent sync activity
      const recentActivity = await prisma.integrationLog.findMany({
        where: {
          tenantId,
          category: 'MARKETPLACE',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          status: true,
          message: true,
          createdAt: true,
        },
      });

      res.json({
        success: true,
        data: {
          marketplaces,
          statistics: {
            totalProducts,
            mappedProducts,
            unmappedProducts: totalProducts - mappedProducts,
            activeMarketplaces: marketplaces.length,
          },
          recentActivity,
        },
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error getting dashboard', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get marketplace products with sync status
   */
  async getProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { page = 1, limit = 20, search, marketplaceId, syncStatus } = req.query;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const whereClause: any = {
        tenantId,
        isActive: true,
      };

      if (search) {
        whereClause.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { sku: { contains: search as string, mode: 'insensitive' } },
          { barcode: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where: whereClause,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            pricing: true,
            stock: true,
            marketplaceProductMaps: marketplaceId ? {
              where: {
                marketplaceId: marketplaceId as string,
              },
              include: {
                marketplace: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            } : {
              include: {
                marketplace: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            },
          },
        }),
        prisma.product.count({ where: whereClause }),
      ]);

      res.json({
        success: true,
        data: {
          products,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error getting products', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Sync products to marketplaces
   */
  async syncProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { marketplaceIds, productIds, syncType } = req.body;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!marketplaceIds || marketplaceIds.length === 0) {
        res.status(400).json({ error: 'At least one marketplace is required' });
        return;
      }

      const results = [];

      // Sync to each marketplace
      for (const marketplaceId of marketplaceIds) {
        try {
          if (syncType === 'price') {
            const priceResult = await priceSyncService.syncMarketplace(tenantId, marketplaceId, productIds);
            results.push(priceResult);
          } else if (syncType === 'stock') {
            const stockResult = await stockSyncService.syncMarketplace(tenantId, marketplaceId, productIds);
            results.push(stockResult);
          } else {
            // Sync both price and stock
            const [priceResult, stockResult] = await Promise.all([
              priceSyncService.syncMarketplace(tenantId, marketplaceId, productIds),
              stockSyncService.syncMarketplace(tenantId, marketplaceId, productIds),
            ]);
            results.push(priceResult, stockResult);
          }
        } catch (error: any) {
          logger.error('[MarketplaceHub] Sync failed', {
            tenantId,
            marketplaceId,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        data: {
          results,
          message: 'Sync completed',
        },
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error syncing products', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get marketplace connections status
   */
  async getConnectionStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const marketplaces = await prisma.marketplaceAccount.findMany({
        where: {
          tenantId,
        },
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          createdAt: true,
          lastSyncAt: true,
          settings: true,
        },
      });

      const connectionStatus = await Promise.all(
        marketplaces.map(async (marketplace) => {
          let isConnected = false;
          let lastError = '';

          if (marketplace.isActive) {
            try {
              isConnected = await stockSyncService.testConnection(tenantId, marketplace.id);
            } catch (error: any) {
              lastError = error.message;
            }
          }

          return {
            id: marketplace.id,
            name: marketplace.name,
            type: marketplace.type,
            isActive: marketplace.isActive,
            isConnected,
            lastError,
            lastSyncAt: marketplace.lastSyncAt,
            createdAt: marketplace.createdAt,
            settings: marketplace.settings,
          };
        })
      );

      res.json({
        success: true,
        data: connectionStatus,
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error getting connection status', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update marketplace settings
   */
  async updateSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { marketplaceId, settings } = req.body;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!marketplaceId || !settings) {
        res.status(400).json({ error: 'Marketplace ID and settings are required' });
        return;
      }

      const marketplace = await prisma.marketplaceAccount.update({
        where: {
          id: marketplaceId,
          tenantId,
        },
        data: {
          settings,
        },
      });

      res.json({
        success: true,
        data: marketplace,
        message: 'Settings updated successfully',
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error updating settings', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get marketplace analytics
   */
  async getAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { period = '30d' } = req.query;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Calculate date range
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get sync statistics
      const syncStats = await prisma.integrationLog.groupBy({
        by: ['status'],
        where: {
          tenantId,
          category: 'MARKETPLACE',
          createdAt: {
            gte: startDate,
          },
        },
        _count: true,
      });

      // Get marketplace performance
      const marketplacePerformance = await prisma.marketplaceAccount.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          type: true,
          _count: {
            select: {
              marketplaceProductMaps: true,
            },
          },
        },
      });

      res.json({
        success: true,
        data: {
          period,
          syncStats,
          marketplacePerformance,
        },
      });
    } catch (error) {
      logger.error('[MarketplaceHub] Error getting analytics', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const marketplaceHubController = new MarketplaceHubController();
