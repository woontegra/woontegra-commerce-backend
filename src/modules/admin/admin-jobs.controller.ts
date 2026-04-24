import { Request, Response } from 'express';
import { triggerAbandonedCartJob } from '../../jobs/abandoned-cart.job';
import { logger } from '../../config/logger';

export class AdminJobsController {
  /**
   * Manually trigger abandoned cart job
   * POST /api/admin/jobs/abandoned-cart
   */
  async triggerAbandonedCart(req: Request, res: Response): Promise<void> {
    try {
      logger.info('[AdminJobs] Manual trigger: abandoned cart job');
      
      // Trigger job asynchronously
      triggerAbandonedCartJob().catch(err => 
        logger.error('[AdminJobs] Job failed', { error: err.message })
      );

      res.json({
        success: true,
        message: 'Abandoned cart job triggered',
      });
    } catch (error) {
      logger.error('[AdminJobs] Error triggering job', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to trigger job',
      });
    }
  }
}

export const adminJobsController = new AdminJobsController();
