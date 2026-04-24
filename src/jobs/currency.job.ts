import cron from 'node-cron';
import { CurrencyService } from '../services/currency.service';
import { logger } from '../config/logger';

/**
 * Update exchange rates every day at 10:00 AM
 */
export function initializeCurrencyJob() {
  // Run every day at 10:00 AM
  cron.schedule('0 10 * * *', async () => {
    try {
      logger.info('[CurrencyJob] Starting exchange rate update...');
      await CurrencyService.updateExchangeRates();
      logger.info('[CurrencyJob] Exchange rates updated successfully');
    } catch (error) {
      logger.error('[CurrencyJob] Failed to update exchange rates', { error });
    }
  });

  logger.info('[CurrencyJob] Currency update job initialized (daily at 10:00 AM)');

  // Run immediately on startup
  setTimeout(async () => {
    try {
      logger.info('[CurrencyJob] Initial exchange rate update...');
      await CurrencyService.updateExchangeRates();
      logger.info('[CurrencyJob] Initial update completed');
    } catch (error) {
      logger.error('[CurrencyJob] Initial update failed', { error });
    }
  }, 5000); // Wait 5 seconds after startup
}
