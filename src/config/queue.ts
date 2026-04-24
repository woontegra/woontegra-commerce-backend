import { Queue, Worker, QueueEvents } from 'bullmq';
import { logger } from './logger';

export interface QueueConfig {
  connection: {
    host: string;
    port: number;
    password?: string;
  };
}

/**
 * Redis connection configuration
 */
export const queueConfig: QueueConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },
};

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

/**
 * Default queue options
 */
export const defaultQueueOptions = {
  connection: queueConfig.connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 1000,
      age: 7 * 24 * 3600, // 7 days
    },
  },
};

/**
 * Create a new queue
 */
export function createQueue(name: string): Queue {
  const queue = new Queue(name, defaultQueueOptions);

  logger.info('[Queue] Created queue', { name });

  return queue;
}

/**
 * Create a new worker
 */
export function createWorker(
  name: string,
  processor: (job: any) => Promise<any>,
  concurrency: number = 5
): Worker {
  const worker = new Worker(name, processor, {
    connection: queueConfig.connection,
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.info('[Queue] Job completed', { 
      queue: name, 
      jobId: job.id,
      jobName: job.name,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('[Queue] Job failed', { 
      queue: name, 
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  logger.info('[Queue] Created worker', { name, concurrency });

  return worker;
}

/**
 * Create queue events listener
 */
export function createQueueEvents(name: string): QueueEvents {
  const queueEvents = new QueueEvents(name, {
    connection: queueConfig.connection,
  });

  queueEvents.on('waiting', ({ jobId }) => {
    logger.debug('[Queue] Job waiting', { queue: name, jobId });
  });

  queueEvents.on('active', ({ jobId }) => {
    logger.debug('[Queue] Job active', { queue: name, jobId });
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    logger.debug('[Queue] Job progress', { queue: name, jobId, progress: data });
  });

  return queueEvents;
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const testQueue = new Queue('test-connection', {
      connection: queueConfig.connection,
    });

    await testQueue.add('test', { test: true });
    await testQueue.close();

    logger.info('[Queue] Redis connection successful', {
      host: queueConfig.connection.host,
      port: queueConfig.connection.port,
    });

    return true;
  } catch (error) {
    logger.error('[Queue] Redis connection failed', { 
      error,
      host: queueConfig.connection.host,
      port: queueConfig.connection.port,
    });
    return false;
  }
}
