import { Job } from 'bullmq';
import { createQueue, createWorker, QUEUE_NAMES } from '../config/queue';
import { WebhookService, WebhookEvent } from '../services/webhook.service';
import { logger } from '../config/logger';

export interface WebhookJobData {
  tenantId: string;
  event: WebhookEvent;
  data: any;
}

// Create webhook queue
export const webhookQueue = createQueue(QUEUE_NAMES.WEBHOOK);

// Webhook processor
async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { tenantId, event, data } = job.data;

  logger.info('[WebhookQueue] Processing webhook job', {
    jobId: job.id,
    tenantId,
    event,
  });

  try {
    await WebhookService.triggerEvent(tenantId, event, data);
  } catch (error) {
    logger.error('[WebhookQueue] Webhook processing failed', {
      error,
      tenantId,
      event,
    });
    throw error;
  }
}

// Create webhook worker
export const webhookWorker = createWorker(
  QUEUE_NAMES.WEBHOOK,
  processWebhookJob,
  10 // 10 concurrent jobs
);

/**
 * Trigger webhook asynchronously
 */
export async function triggerWebhookAsync(
  tenantId: string,
  event: WebhookEvent,
  data: any
): Promise<void> {
  await webhookQueue.add('trigger-webhook', {
    tenantId,
    event,
    data,
  }, {
    priority: 1,
  });

  logger.info('[WebhookQueue] Webhook job added', {
    tenantId,
    event,
  });
}
