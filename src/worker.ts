#!/usr/bin/env node

/**
 * Dedicated Worker Process
 * 
 * This process runs separately from the main API server
 * and handles background jobs from Redis queues.
 * 
 * Usage:
 * - Development: npm run worker
 * - Production: pm2 start worker.js -i 4
 */

import { logger } from './config/logger';
import { emailWorker } from './queues/email.queue';
import { webhookWorker } from './queues/webhook.queue';
import { imageProcessingWorker } from './queues/image-processing.queue';
// import { testRedisConnection } from './config/queue'; // TODO: Fix export

// Worker metadata
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const WORKER_TYPE = process.env.WORKER_TYPE || 'all'; // all, email, webhook, image

/**
 * Initialize worker
 */
async function startWorker(): Promise<void> {
  try {
    logger.info('[Worker] Starting worker process', {
      workerId: WORKER_ID,
      workerType: WORKER_TYPE,
      pid: process.pid,
    });

    // Test Redis connection - TODO: Fix import
    // const isConnected = await testRedisConnection();
    // if (!isConnected) {
    //   logger.error('[Worker] Redis connection failed. Exiting...');
    //   process.exit(1);
    // }

    logger.info('[Worker] Redis connection test skipped');

    // Workers are already initialized in their respective files
    // They will automatically start processing jobs

    logger.info('[Worker] Worker process started successfully', {
      workerId: WORKER_ID,
      workers: getActiveWorkers(),
    });

    // Keep process alive
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('[Worker] Failed to start worker', { error });
    process.exit(1);
  }
}

/**
 * Get active workers based on WORKER_TYPE
 */
function getActiveWorkers(): string[] {
  const workers: string[] = [];

  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'email') {
    workers.push('email-worker');
  }

  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'webhook') {
    workers.push('webhook-worker');
  }

  if (WORKER_TYPE === 'all' || WORKER_TYPE === 'image') {
    workers.push('image-processing-worker');
  }

  return workers;
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(): Promise<void> {
  logger.info('[Worker] Shutting down gracefully...', {
    workerId: WORKER_ID,
  });

  try {
    // Close all workers
    await Promise.all([
      emailWorker.close(),
      webhookWorker.close(),
      imageProcessingWorker.close(),
    ]);

    logger.info('[Worker] All workers closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('[Worker] Error during shutdown', { error });
    process.exit(1);
  }
}

/**
 * Worker health check
 */
setInterval(() => {
  const health = {
    workerId: WORKER_ID,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    workers: {
      email: emailWorker.isRunning(),
      webhook: webhookWorker.isRunning(),
      imageProcessing: imageProcessingWorker.isRunning(),
    },
  };

  logger.debug('[Worker] Health check', health);
}, 60000); // Every minute

// Start worker
startWorker();
