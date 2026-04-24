import { startAbandonedCartJob as initializeAbandonedCartJob } from './abandoned-cart.job';
import { initializeCurrencyJob } from './currency.job';
import { logger } from '../config/logger';

/**
 * Initialize all cron jobs
 */
export function initializeJobs(): void {
  logger.info('[Jobs] Initializing cron jobs...');
  
  // Abandoned cart job
  initializeAbandonedCartJob();
  
  // Currency update job
  initializeCurrencyJob();
  
  logger.info('[Jobs] All cron jobs initialized');
}
