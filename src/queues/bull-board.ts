import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Router } from 'express';
import { getEmailQueue } from './email.queue';
import { getWebhookQueue } from './webhook.queue';
import { getImageProcessingQueue } from './image-processing.queue';

export function createBullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(getEmailQueue()),
      new BullMQAdapter(getWebhookQueue()),
      new BullMQAdapter(getImageProcessingQueue()),
    ],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
