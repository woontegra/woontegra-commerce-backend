import { logger } from '../../config/logger';
import {
  sendEmailAsync,
  queueErrorAlertEmail,
  queuePasswordResetEmail,
} from '../../queues/email.queue';
import { renderEmailTemplate, templates, type TemplateKey } from '../email/templates';

export type { TemplateKey };
export { templates };

/**
 * Bildirim e-postaları — gönderim BullMQ kuyruğu üzerinden (retry + provider).
 */
export class EmailService {
  async send(to: string, subject: string, html: string): Promise<void> {
    await sendEmailAsync({ to, subject, html });
    logger.info({ message: '[EmailService] Queued raw email', to, subject });
  }

  async sendTemplate<K extends TemplateKey>(
    to: string,
    key: K,
    data: Parameters<typeof templates[K]>[0],
  ): Promise<void> {
    await sendEmailAsync({
      to,
      template: key,
      templateData: data as Record<string, unknown>,
    });
    logger.info({ message: '[EmailService] Queued template email', to, template: key });
  }

  async sendPasswordReset(
    to: string,
    data: { resetUrl: string; userName?: string; expiresInMinutes?: number },
  ): Promise<void> {
    await queuePasswordResetEmail(to, data);
  }

  async sendErrorAlert(to: string, data: Record<string, unknown>): Promise<void> {
    await queueErrorAlertEmail(to, data);
  }

  /** Önizleme (kuyruğa eklemeden) */
  previewTemplate<K extends TemplateKey>(
    key: K,
    data: Parameters<typeof templates[K]>[0],
  ): { subject: string; html: string } {
    return renderEmailTemplate(key, data as Record<string, unknown>);
  }
}

export const emailService = new EmailService();
