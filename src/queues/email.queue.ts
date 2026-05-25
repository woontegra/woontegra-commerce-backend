import { Job } from 'bullmq';
import { createQueue, createWorker, QUEUE_NAMES } from '../config/queue';
import { logger } from '../config/logger';
import { deliverEmail } from '../modules/email/email.provider';
import { renderEmailTemplate, type TemplateKey } from '../modules/email/templates';

const EMAIL_JOB_ATTEMPTS = parseInt(process.env.EMAIL_QUEUE_ATTEMPTS || '5', 10);
const EMAIL_JOB_BACKOFF_MS = parseInt(process.env.EMAIL_QUEUE_BACKOFF_MS || '3000', 10);

export interface EmailJobData {
  to: string;
  /** Şablon modu */
  template?: TemplateKey;
  templateData?: Record<string, unknown>;
  /** Ham HTML modu (şablon yok) */
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

function resolvePayload(data: EmailJobData): { to: string; subject: string; html: string; text?: string; from?: string } {
  if (data.template) {
    const rendered = renderEmailTemplate(data.template, data.templateData ?? {});
    return {
      to:      data.to,
      subject: rendered.subject,
      html:    rendered.html,
      text:    data.text,
      from:    data.from,
    };
  }

  if (!data.subject || !data.html) {
    throw new Error('E-posta işi: template veya subject+html zorunludur.');
  }

  return {
    to:      data.to,
    subject: data.subject,
    html:    data.html,
    text:    data.text,
    from:    data.from,
  };
}

export const emailQueue = createQueue(QUEUE_NAMES.EMAIL);

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const resolved = resolvePayload(job.data);

  logger.info('[EmailQueue] Processing', {
    jobId:    job.id,
    attempt:  job.attemptsMade + 1,
    to:       resolved.to,
    subject:  resolved.subject,
    template: job.data.template,
  });

  if (job.data.attachments?.length) {
    logger.warn({ message: '[EmailQueue] Attachments not yet supported in provider', jobId: job.id });
  }

  await deliverEmail(resolved);
}

export const emailWorker = createWorker(
  QUEUE_NAMES.EMAIL,
  processEmailJob,
  5,
);

const defaultJobOpts = {
  attempts: EMAIL_JOB_ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: EMAIL_JOB_BACKOFF_MS,
  },
  removeOnComplete: { count: 200, age: 24 * 3600 },
  removeOnFail:       { count: 500, age: 7 * 24 * 3600 },
};

export async function sendEmailAsync(data: EmailJobData): Promise<string | undefined> {
  const job = await emailQueue.add('send-email', data, {
    priority: 1,
    ...defaultJobOpts,
  });

  logger.info('[EmailQueue] Job queued', {
    jobId: job.id,
    to:    data.to,
    template: data.template,
    subject: data.subject,
  });

  return job.id;
}

export async function sendBulkEmailsAsync(emails: EmailJobData[]): Promise<void> {
  const jobs = emails.map(email => ({
    name: 'send-email',
    data: email,
    opts: { priority: 2, ...defaultJobOpts },
  }));

  await emailQueue.addBulk(jobs);

  logger.info('[EmailQueue] Bulk jobs queued', { count: emails.length });
}

/** Şablonlu kuyruk kısayolları */
export async function queuePasswordResetEmail(
  to: string,
  data: { resetUrl: string; userName?: string; expiresInMinutes?: number },
) {
  return sendEmailAsync({
    to,
    template: 'PASSWORD_RESET',
    templateData: data,
  });
}

export async function queueSubscriptionEmail(
  to: string,
  data: Record<string, unknown>,
) {
  return sendEmailAsync({
    to,
    template: 'SUBSCRIPTION_NOTIFICATION',
    templateData: data,
  });
}

export async function queueErrorAlertEmail(
  to: string,
  data: Record<string, unknown>,
) {
  return sendEmailAsync({
    to,
    template: 'ERROR_ALERT',
    templateData: data,
  });
}
