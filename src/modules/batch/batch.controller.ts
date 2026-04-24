import { Request, Response } from 'express';
import { addBatchJob, getBatchJobStatus, BatchJobType } from '../../queues/batch.queue';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class BatchController {
  /**
   * Create a batch job
   */
  async createBatchJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!tenantId || !userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { type, items, options } = req.body;

      if (!type || !items || !Array.isArray(items)) {
        res.status(400).json({ error: 'Type and items array are required' });
        return;
      }

      if (items.length === 0) {
        res.status(400).json({ error: 'Items array cannot be empty' });
        return;
      }

      if (items.length > 10000) {
        res.status(400).json({ error: 'Maximum 10,000 items per batch' });
        return;
      }

      const jobId = await addBatchJob({
        type: type as BatchJobType,
        tenantId,
        userId,
        items,
        options,
      });

      res.json({
        success: true,
        data: {
          jobId,
          itemCount: items.length,
          message: 'Batch job created successfully',
        },
      });
    } catch (error) {
      console.error('Error creating batch job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get batch job status
   */
  async getBatchJobStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      const status = await getBatchJobStatus(jobId);

      res.json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      if (error.message === 'Batch job not found') {
        res.status(404).json({ error: 'Batch job not found' });
        return;
      }

      console.error('Error getting batch job status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Bulk update products
   */
  async bulkUpdateProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!tenantId || !userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { productIds, data } = req.body;

      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'Product IDs array is required' });
        return;
      }

      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'Update data is required' });
        return;
      }

      const items = productIds.map(id => ({
        model: 'product',
        id,
        data,
      }));

      const jobId = await addBatchJob({
        type: 'bulk-update',
        tenantId,
        userId,
        items,
      });

      res.json({
        success: true,
        data: {
          jobId,
          itemCount: items.length,
          message: 'Bulk update job created',
        },
      });
    } catch (error) {
      console.error('Error creating bulk update:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Bulk delete products
   */
  async bulkDeleteProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!tenantId || !userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { productIds } = req.body;

      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'Product IDs array is required' });
        return;
      }

      const items = productIds.map(id => ({
        model: 'product',
        id,
      }));

      const jobId = await addBatchJob({
        type: 'bulk-delete',
        tenantId,
        userId,
        items,
      });

      res.json({
        success: true,
        data: {
          jobId,
          itemCount: items.length,
          message: 'Bulk delete job created',
        },
      });
    } catch (error) {
      console.error('Error creating bulk delete:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Bulk import products
   */
  async bulkImportProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!tenantId || !userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { products } = req.body;

      if (!products || !Array.isArray(products) || products.length === 0) {
        res.status(400).json({ error: 'Products array is required' });
        return;
      }

      const items = products.map(product => ({
        model: 'product',
        data: product,
      }));

      const jobId = await addBatchJob({
        type: 'bulk-import',
        tenantId,
        userId,
        items,
      });

      res.json({
        success: true,
        data: {
          jobId,
          itemCount: items.length,
          message: 'Bulk import job created',
        },
      });
    } catch (error) {
      console.error('Error creating bulk import:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const batchController = new BatchController();
