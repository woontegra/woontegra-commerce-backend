import { isRedisConfigured } from '../config/queue';
import { logger } from '../config/logger';
import { initEmailQueue, getEmailQueue, getEmailWorker } from './email.queue';
import { initWebhookQueue, getWebhookQueue, getWebhookWorker } from './webhook.queue';
import {
  initImageProcessingQueue,
  getImageProcessingQueue,
  getImageProcessingWorker,
} from './image-processing.queue';

export async function initializeQueues(): Promise<void> {
  if (!isRedisConfigured()) {
    logger.warn('[Queues] REDIS_URL tanımlı değil — kuyruk sistemi devre dışı');
    return;
  }

  try {
    logger.info('[Queues] Initializing queues...');
    initEmailQueue();
    initWebhookQueue();
    initImageProcessingQueue();

    logger.info('[Queues] All queues initialized', {
      queues: ['email-queue', 'webhook-queue', 'image-processing-queue'],
    });
    logger.info('[Queues] All workers started');
  } catch (error) {
    logger.error('[Queues] Failed to initialize queues', { error });
    throw error;
  }
}

export async function closeQueues(): Promise<void> {
  if (!isRedisConfigured()) return;

  try {
    logger.info('[Queues] Closing queues...');

    await Promise.all([
      getEmailQueue().close().catch(() => undefined),
      getWebhookQueue().close().catch(() => undefined),
      getImageProcessingQueue().close().catch(() => undefined),
      getEmailWorker().close().catch(() => undefined),
      getWebhookWorker().close().catch(() => undefined),
      getImageProcessingWorker().close().catch(() => undefined),
    ]);

    logger.info('[Queues] All queues closed');
  } catch (error) {
    logger.error('[Queues] Error closing queues', { error });
  }
}

export {
  getEmailQueue as emailQueue,
  getEmailWorker as emailWorker,
  getWebhookQueue as webhookQueue,
  getWebhookWorker as webhookWorker,
  getImageProcessingQueue as imageProcessingQueue,
  getImageProcessingWorker as imageProcessingWorker,
};

export {
  sendEmailAsync,
  sendBulkEmailsAsync,
  queuePasswordResetEmail,
  queueSubscriptionEmail,
  queueErrorAlertEmail,
} from './email.queue';
export { triggerWebhookAsync } from './webhook.queue';
export { processImageAsync } from './image-processing.queue';
