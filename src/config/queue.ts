import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';

let redisConnection: IORedis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getRedisConnection(): IORedis {
  if (!isRedisConfigured()) {
    throw new Error('REDIS_URL tanımlı değil!');
  }

  if (!redisConnection) {
    redisConnection = new IORedis(process.env.REDIS_URL!.trim(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  return redisConnection;
}

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  WEBHOOK: 'webhook-queue',
  IMAGE_PROCESSING: 'image-processing-queue',
  EXPORT: 'export-queue',
  NOTIFICATION: 'notification-queue',
  BATCH: 'batch-queue',
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: {
    count: 100,
    age: 24 * 3600,
  },
  removeOnFail: {
    count: 1000,
    age: 7 * 24 * 3600,
  },
};

/**
 * Create queue
 */
export function createQueue(name: string): Queue {
  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
  logger.info('[Queue] Created queue', { name });
  return queue;
}

/**
 * Create worker
 */
export function createWorker(
  name: string,
  processor: (job: any) => Promise<any>,
  concurrency: number = 5,
): Worker {
  const worker = new Worker(name, processor, {
    connection: getRedisConnection(),
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.info('[Queue] Job completed', {
      queue: name,
      jobId: job.id,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('[Queue] Job failed', {
      queue: name,
      jobId: job?.id,
      error: err.message,
    });
  });

  logger.info('[Queue] Created worker', { name, concurrency });
  return worker;
}

/**
 * Queue events
 */
export function createQueueEvents(name: string): QueueEvents {
  return new QueueEvents(name, {
    connection: getRedisConnection(),
  });
}
