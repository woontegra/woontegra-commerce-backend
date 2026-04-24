import { Request, Response } from 'express';
import { MarketplaceService } from './marketplace.service';
import { PrismaClient, MarketplaceProvider } from '@prisma/client';
import { getTenantFromRequest } from '../../common/utils/tenant.util';

export class MarketplaceController {
  constructor(
    private marketplaceService: MarketplaceService,
    private prisma: PrismaClient
  ) {}

  // CONNECTION ENDPOINTS
  async connectMarketplace(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { provider, apiKey, apiSecret, sellerId } = req.body;

      if (!provider || !apiKey || !apiSecret || !sellerId) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: provider, apiKey, apiSecret, sellerId',
        });
        return;
      }

      if (!Object.values(MarketplaceProvider).includes(provider)) {
        res.status(400).json({
          success: false,
          message: 'Invalid marketplace provider',
        });
        return;
      }

      const account = await this.marketplaceService.connectMarketplace(tenantId, {
        provider,
        apiKey,
        apiSecret,
        sellerId,
      });

      res.status(201).json({
        success: true,
        message: 'Marketplace connected successfully',
        data: {
          id: account.id,
          provider: account.provider,
          sellerId: account.sellerId,
          isActive: account.isActive,
          createdAt: account.createdAt,
        },
      });
    } catch (error) {
      console.error('Connect marketplace error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to connect marketplace',
      });
    }
  }

  async disconnectMarketplace(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { provider } = req.body;

      if (!provider) {
        res.status(400).json({
          success: false,
          message: 'Provider is required',
        });
        return;
      }

      await this.marketplaceService.disconnectMarketplace(tenantId, provider);

      res.json({
        success: true,
        message: 'Marketplace disconnected successfully',
      });
    } catch (error) {
      console.error('Disconnect marketplace error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to disconnect marketplace',
      });
    }
  }

  async getMarketplaceAccounts(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const accounts = await this.marketplaceService.getMarketplaceAccounts(tenantId);

      res.json({
        success: true,
        data: accounts,
      });
    } catch (error) {
      console.error('Get marketplace accounts error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch marketplace accounts',
      });
    }
  }

  // PRODUCT EXPORT ENDPOINTS
  async exportProduct(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { productId, marketplace, categoryId, brandId } = req.body;

      if (!productId || !marketplace) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: productId, marketplace',
        });
        return;
      }

      const result = await this.marketplaceService.exportProduct(tenantId, {
        productId,
        marketplace,
        categoryId,
        brandId,
      });

      res.json({
        success: true,
        message: 'Product exported successfully',
        data: result,
      });
    } catch (error) {
      console.error('Export product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to export product',
      });
    }
  }

  async exportMultipleProducts(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { productIds, marketplace, categoryId, brandId } = req.body;

      if (!productIds || !Array.isArray(productIds) || !marketplace) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: productIds (array), marketplace',
        });
        return;
      }

      const results = [];
      const errors = [];

      for (const productId of productIds) {
        try {
          const result = await this.marketplaceService.exportProduct(tenantId, {
            productId,
            marketplace,
            categoryId,
            brandId,
          });
          results.push({ productId, success: true, result });
        } catch (error) {
          errors.push({ productId, success: false, error: error.message });
        }
      }

      res.json({
        success: true,
        message: `Exported ${results.length} products successfully`,
        data: {
          results,
          errors,
          summary: {
            total: productIds.length,
            successful: results.length,
            failed: errors.length,
          },
        },
      });
    } catch (error) {
      console.error('Export multiple products error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to export products',
      });
    }
  }

  // STOCK & PRICE SYNC ENDPOINTS
  async updateStockAndPrice(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { updates } = req.body;

      if (!updates || !Array.isArray(updates)) {
        res.status(400).json({
          success: false,
          message: 'Missing required field: updates (array)',
        });
        return;
      }

      // Validate update format
      for (const update of updates) {
        if (!update.productId || !update.marketplace || update.quantity === undefined || !update.price) {
          res.status(400).json({
            success: false,
            message: 'Each update must contain: productId, marketplace, quantity, price',
          });
          return;
        }
      }

      await this.marketplaceService.updateStockAndPrice(tenantId, updates);

      res.json({
        success: true,
        message: 'Stock and price updated successfully',
        data: {
          updatedCount: updates.length,
        },
      });
    } catch (error) {
      console.error('Update stock and price error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update stock and price',
      });
    }
  }

  async updateAllStockAndPrice(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace } = req.body;

      if (!marketplace) {
        res.status(400).json({
          success: false,
          message: 'Marketplace is required',
        });
        return;
      }

      // Get all products with marketplace mapping
      const productMaps = await this.prisma.marketplaceProductMap.findMany({
        where: {
          tenantId,
          marketplace,
          isActive: true,
        },
        include: {
          product: {
            select: {
              id: true,
              price: true,
              sku: true,
            },
          },
        },
      });

      // Get stock information
      const productIds = productMaps.map(map => map.productId);
      const stocks = await this.prisma.stock.findMany({
        where: {
          productId: { in: productIds },
        },
      });

      // Prepare updates
      const updates = productMaps.map(map => {
        const stock = stocks.find(s => s.productId === map.productId);
        return {
          productId: map.productId,
          marketplace,
          quantity: stock?.quantity || 0,
          price: Number(map.product.price),
        };
      });

      await this.marketplaceService.updateStockAndPrice(tenantId, updates);

      res.json({
        success: true,
        message: 'All stock and price updated successfully',
        data: {
          updatedCount: updates.length,
        },
      });
    } catch (error) {
      console.error('Update all stock and price error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update all stock and price',
      });
    }
  }

  // ORDER IMPORT ENDPOINTS
  async importOrders(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace } = req.body;

      if (!marketplace) {
        res.status(400).json({
          success: false,
          message: 'Marketplace is required',
        });
        return;
      }

      const orders = await this.marketplaceService.importOrders(tenantId, marketplace);

      res.json({
        success: true,
        message: 'Orders imported successfully',
        data: {
          importedCount: orders.length,
          orders,
        },
      });
    } catch (error) {
      console.error('Import orders error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to import orders',
      });
    }
  }

  async getOrders(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace, page = 1, limit = 20, status } = req.query;

      const where: any = {
        tenantId,
      };

      if (marketplace) {
        where.marketplace = marketplace as MarketplaceProvider;
      }

      if (status) {
        where.status = status as string;
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [orders, total] = await Promise.all([
        this.prisma.marketplaceOrder.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.marketplaceOrder.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          orders,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      console.error('Get orders error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch orders',
      });
    }
  }

  // SYNC LOGS ENDPOINTS
  async getSyncLogs(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace, syncType, status, page = 1, limit = 20 } = req.query;

      const where: any = {
        tenantId,
      };

      if (marketplace) {
        where.marketplace = marketplace as MarketplaceProvider;
      }

      if (syncType) {
        where.syncType = syncType as string;
      }

      if (status) {
        where.status = status as string;
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [logs, total] = await Promise.all([
        this.prisma.marketplaceSyncLog.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.marketplaceSyncLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      console.error('Get sync logs error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch sync logs',
      });
    }
  }

  // PRODUCT MAPS ENDPOINTS
  async getProductMaps(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace, page = 1, limit = 20 } = req.query;

      const where: any = {
        tenantId,
      };

      if (marketplace) {
        where.marketplace = marketplace as MarketplaceProvider;
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [productMaps, total] = await Promise.all([
        this.prisma.marketplaceProductMap.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                isActive: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.marketplaceProductMap.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          productMaps,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      console.error('Get product maps error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch product maps',
      });
    }
  }

  // HEALTH CHECK ENDPOINT
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = getTenantFromRequest(req);
      const { marketplace } = req.query;

      if (!marketplace) {
        res.status(400).json({
          success: false,
          message: 'Marketplace is required',
        });
        return;
      }

      const accounts = await this.marketplaceService.getMarketplaceAccounts(tenantId);
      const account = accounts.find(acc => acc.provider === marketplace);

      if (!account) {
        res.status(404).json({
          success: false,
          message: 'Marketplace account not found',
        });
        return;
      }

      // For now, just return account status
      res.json({
        success: true,
        data: {
          marketplace,
          isActive: account.isActive,
          lastSyncAt: account.lastSyncAt,
        },
      });
    } catch (error) {
      console.error('Health check error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Health check failed',
      });
    }
  }
}
