import cron from 'node-cron';
import { abandonedCartMailService } from '../services/abandoned-cart-mail.service';
import { logger } from '../config/logger';

/**
 * Abandoned Cart Cron Job
 * Runs every hour to check for abandoned carts and send reminder emails
 */
export function startAbandonedCartJob(): void {
  // Run every hour at minute 0
  // Cron format: minute hour day month weekday
  const schedule = '0 * * * *'; // Every hour at :00

  cron.schedule(schedule, async () => {
    logger.info('[AbandonedCartJob] Starting scheduled job');
    
    try {
      await abandonedCartMailService.processAbandonedCarts();
    } catch (error) {
      logger.error('[AbandonedCartJob] Job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  logger.info('[AbandonedCartJob] Cron job scheduled', { schedule });
}

/**
 * Manual trigger for testing
 */
export async function triggerAbandonedCartJob(): Promise<void> {
  logger.info('[AbandonedCartJob] Manual trigger');
  await abandonedCartMailService.processAbandonedCarts();
}
