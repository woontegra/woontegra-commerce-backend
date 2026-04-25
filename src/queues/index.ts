import { emailQueue, emailWorker } from './email.queue';
import { webhookQueue, webhookWorker } from './webhook.queue';
import { imageProcessingQueue, imageProcessingWorker } from './image-processing.queue';
import { logger } from '../config/logger';

/**
 * Initialize all queues and workers
 */
export async function initializeQueues(): Promise<void> {
  try {
    logger.info('[Queues] Initializing queues...');

    // Queues initialized - Redis connection handled by BullMQ
    logger.info('[Queues] Redis connection managed by BullMQ');

    // Queues are already created in their respective files
    logger.info('[Queues] All queues initialized', {
      queues: [
        'email-queue',
        'webhook-queue',
        'image-processing-queue',
      ],
    });

    // Workers are already created in their respective files
    logger.info('[Queues] All workers started');
  } catch (error) {
    logger.error('[Queues] Failed to initialize queues', { error });
    throw error;
  }
}

/**
 * Gracefully close all queues and workers
 */
export async function closeQueues(): Promise<void> {
  try {
    logger.info('[Queues] Closing queues...');

    await Promise.all([
      emailQueue.close(),
      webhookQueue.close(),
      imageProcessingQueue.close(),
      emailWorker.close(),
      webhookWorker.close(),
      imageProcessingWorker.close(),
    ]);

    logger.info('[Queues] All queues closed');
  } catch (error) {
    logger.error('[Queues] Error closing queues', { error });
  }
}

// Export queues and workers
export {
  emailQueue,
  emailWorker,
  webhookQueue,
  webhookWorker,
  imageProcessingQueue,
  imageProcessingWorker,
};

// Export queue functions
export { sendEmailAsync, sendBulkEmailsAsync } from './email.queue';
export { triggerWebhookAsync } from './webhook.queue';
export { processImageAsync } from './image-processing.queue';
