import { Job, Queue, Worker } from 'bullmq';
import { createQueue, createWorker, isRedisConfigured, QUEUE_NAMES } from '../config/queue';
import { WebhookService, WebhookEvent } from '../services/webhook.service';
import { logger } from '../config/logger';

export interface WebhookJobData {
  tenantId: string;
  event: WebhookEvent;
  data: any;
}

let webhookQueueInstance: Queue | undefined;
let webhookWorkerInstance: Worker | undefined;

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

export function initWebhookQueue(): void {
  if (webhookQueueInstance) return;
  webhookQueueInstance = createQueue(QUEUE_NAMES.WEBHOOK);
  webhookWorkerInstance = createWorker(QUEUE_NAMES.WEBHOOK, processWebhookJob, 10);
}

export function getWebhookQueue(): Queue {
  initWebhookQueue();
  return webhookQueueInstance!;
}

export function getWebhookWorker(): Worker {
  initWebhookQueue();
  return webhookWorkerInstance!;
}

export async function triggerWebhookAsync(
  tenantId: string,
  event: WebhookEvent,
  data: any,
): Promise<void> {
  if (!isRedisConfigured()) {
    logger.warn('[WebhookQueue] REDIS_URL yok — webhook kuyruğa alınamadı', { tenantId, event });
    return;
  }

  await getWebhookQueue().add(
    'trigger-webhook',
    { tenantId, event, data },
    { priority: 1 },
  );

  logger.info('[WebhookQueue] Webhook job added', { tenantId, event });
}
