import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from './email.queue';
import { webhookQueue } from './webhook.queue';
import { imageProcessingQueue } from './image-processing.queue';

/**
 * Bull Board - Queue Dashboard
 */
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(webhookQueue),
    new BullMQAdapter(imageProcessingQueue),
  ],
  serverAdapter,
});

export const bullBoardRouter = serverAdapter.getRouter();
