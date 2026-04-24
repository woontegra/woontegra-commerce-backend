import { Request, Response } from 'express';
import { stockSyncService } from '../../services/marketplace-sync.service';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class StockSyncController {
  /**
   * Get active marketplaces
   */
  async getMarketplaces(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const marketplaces = await stockSyncService.getActiveMarketplaces(tenantId);

      res.json({ success: true, data: marketplaces });
    } catch (error) {
      logger.error('[StockSync] Error getting marketplaces', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get stock products for sync
   */
  async getStockProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { productIds } = req.body;
      const products = await stockSyncService.getStockProducts(tenantId, productIds);

      res.json({ success: true, data: products });
    } catch (error) {
      logger.error('[StockSync] Error getting stock products', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Sync stock to all marketplaces
   */
  async syncAllMarketplaces(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { productIds } = req.body;

      // Start sync process (async)
      const syncPromise = stockSyncService.syncAllMarketplaces(tenantId, productIds);

      // Handle sync asynchronously
      syncPromise
        .then(results => {
          logger.info('[StockSync] All marketplaces sync completed', {
            tenantId,
            results: results.map(r => ({
              marketplace: r.marketplaceName,
              succeeded: r.succeeded,
              failed: r.failed,
            })),
          });
        })
        .catch(error => {
          logger.error('[StockSync] All marketplaces sync failed', {
            tenantId,
            error: error.message,
          });
        });

      res.json({
        success: true,
        message: 'Stock sync started for all active marketplaces',
      });
    } catch (error) {
      logger.error('[StockSync] Error starting sync', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Sync stock to specific marketplace
   */
  async syncMarketplace(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { marketplaceId, productIds } = req.body;

      if (!marketplaceId) {
        res.status(400).json({ error: 'Marketplace ID is required' });
        return;
      }

      const result = await stockSyncService.syncMarketplace(tenantId, marketplaceId, productIds);

      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('[StockSync] Error syncing marketplace', { error });
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }

  /**
   * Test marketplace connection
   */
  async testConnection(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { marketplaceId } = req.body;

      if (!marketplaceId) {
        res.status(400).json({ error: 'Marketplace ID is required' });
        return;
      }

      const isConnected = await stockSyncService.testConnection(tenantId, marketplaceId);

      res.json({
        success: true,
        data: {
          connected: isConnected,
          message: isConnected ? 'Connection successful' : 'Connection failed',
        },
      });
    } catch (error: any) {
      logger.error('[StockSync] Error testing connection', { error });
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }

  /**
   * Get sync history
   */
  async getSyncHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { page = 1, limit = 20, marketplaceId } = req.query;

      // TODO: Implement sync history tracking
      // This would require a sync history table

      res.json({
        success: true,
        data: {
          history: [],
          pagination: {
            total: 0,
            page: Number(page),
            limit: Number(limit),
            totalPages: 0,
          },
        },
      });
    } catch (error) {
      logger.error('[StockSync] Error getting sync history', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Manual stock update trigger
   */
  async triggerStockUpdate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { productId, newQuantity, oldQuantity } = req.body;

      if (!productId || newQuantity === undefined) {
        res.status(400).json({ error: 'Product ID and new quantity are required' });
        return;
      }

      await stockSyncService.handleStockChange(tenantId, productId, newQuantity, oldQuantity || 0);

      res.json({
        success: true,
        message: 'Stock update triggered successfully',
      });
    } catch (error: any) {
      logger.error('[StockSync] Error triggering stock update', { error });
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
}

export const stockSyncController = new StockSyncController();
