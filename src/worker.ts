#!/usr/bin/env node

/**
 * Dedicated Worker Process
 *
 * Runs separately from the main API server and handles background jobs.
 */

import { logger } from './config/logger';
import { isRedisConfigured } from './config/queue';
import { getEmailWorker, initEmailQueue } from './queues/email.queue';
import { getWebhookWorker, initWebhookQueue } from './queues/webhook.queue';
import { getImageProcessingWorker, initImageProcessingQueue } from './queues/image-processing.queue';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const WORKER_TYPE = process.env.WORKER_TYPE || 'all';

async function startWorker(): Promise<void> {
  try {
    if (!isRedisConfigured()) {
      logger.error('[Worker] REDIS_URL tanımlı değil. Exiting...');
      process.exit(1);
    }

    logger.info('[Worker] Starting worker process', {
      workerId: WORKER_ID,
      workerType: WORKER_TYPE,
      pid: process.pid,
    });

    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'email') initEmailQueue();
    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'webhook') initWebhookQueue();
    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'image') initImageProcessingQueue();

    logger.info('[Worker] Worker process started successfully', {
      workerId: WORKER_ID,
      workers: getActiveWorkers(),
    });

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    logger.error('[Worker] Failed to start worker', { error });
    process.exit(1);
  }
}

function getActiveWorkers(): string[] {
  const workers: string[] = [];
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'email') workers.push('email-worker');
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'webhook') workers.push('webhook-worker');
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'image') workers.push('image-processing-worker');
  return workers;
}

async function gracefulShutdown(): Promise<void> {
  logger.info('[Worker] Shutting down gracefully...', { workerId: WORKER_ID });

  try {
    const closers: Promise<void>[] = [];
    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'email') closers.push(getEmailWorker().close());
    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'webhook') closers.push(getWebhookWorker().close());
    if (WORKER_TYPE === 'all' || WORKER_TYPE === 'image') {
      closers.push(getImageProcessingWorker().close());
    }

    await Promise.all(closers);
    logger.info('[Worker] All workers closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('[Worker] Error during shutdown', { error });
    process.exit(1);
  }
}

setInterval(() => {
  const workers: Record<string, boolean> = {};
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'email') workers.email = getEmailWorker().isRunning();
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'webhook') workers.webhook = getWebhookWorker().isRunning();
  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'image') {
    workers.imageProcessing = getImageProcessingWorker().isRunning();
  }

  logger.debug('[Worker] Health check', {
    workerId: WORKER_ID,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    workers,
  });
}, 60000);

startWorker();
