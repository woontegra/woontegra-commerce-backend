import type { TemplateKey } from '../modules/email/templates';
import type { EmailTemplateKey } from '../modules/email-templates/email-template.keys';

export interface EmailJobData {
  to: string;
  tenantId?: string;
  tenantTemplateKey?: EmailTemplateKey;
  template?: TemplateKey;
  templateData?: Record<string, unknown>;
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}
