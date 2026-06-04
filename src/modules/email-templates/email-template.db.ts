import prisma from '../../config/database';
import { logger } from '../../config/logger';
import {
  EMAIL_TEMPLATE_KEYS,
  isEmailTemplateKey,
  type EmailTemplateKey,
} from './email-template.keys';
import { TENANT_EMAIL_TEMPLATE_DEFAULTS } from './email-template.defaults';

type EmailTemplateRow = {
  id: string;
  key: string;
  name: string;
  subject: string;
  preheader: string | null;
  bodyHtml: string;
  bodyText: string | null;
  isActive: boolean;
  isSystem: boolean;
  updatedAt: Date;
};

type EmailTemplateDelegate = {
  count: (args: { where: { tenantId: string } }) => Promise<number>;
  findMany: (args: {
    where: { tenantId: string };
    orderBy?: Array<{ isSystem?: 'desc' | 'asc'; name?: 'asc' }> | { name: 'asc' };
  }) => Promise<EmailTemplateRow[]>;
  findUnique: (args: {
    where: { tenantId_key: { tenantId: string; key: string } };
  }) => Promise<EmailTemplateRow | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<EmailTemplateRow>;
  update: (args: {
    where: { tenantId_key: { tenantId: string; key: string } };
    data: Record<string, unknown>;
  }) => Promise<EmailTemplateRow>;
  delete: (args: {
    where: { tenantId_key: { tenantId: string; key: string } };
  }) => Promise<EmailTemplateRow>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

export function getEmailTemplateDelegate(): EmailTemplateDelegate | null {
  const delegate = (prisma as unknown as { emailTemplate?: EmailTemplateDelegate })
    .emailTemplate;
  return delegate ?? null;
}

export function isEmailTemplatesTableMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2021' || code === 'P2022') return true;
  const msg = String((err as { message?: string }).message ?? '').toLowerCase();
  return (
    msg.includes('email_templates') &&
    (msg.includes('does not exist') ||
      msg.includes('unknown column') ||
      msg.includes('no such column') ||
      msg.includes('column') && msg.includes('not exist'))
  );
}

export function isEmailTemplatesDbUnavailable(err: unknown): boolean {
  if (!getEmailTemplateDelegate()) return true;
  return isEmailTemplatesTableMissing(err);
}

export function normalizeListRow(row: {
  id: string;
  key: string;
  name: string;
  subject: string;
  preheader: string | null;
  isActive: boolean;
  isSystem?: boolean;
  updatedAt: Date;
}): EmailTemplateListRow {
  return {
    id:        row.id,
    key:       row.key,
    name:      row.name,
    subject:   row.subject,
    preheader: row.preheader,
    isActive:  row.isActive,
    isSystem:  typeof row.isSystem === 'boolean' ? row.isSystem : isEmailTemplateKey(row.key),
    updatedAt: row.updatedAt,
  };
}

export function normalizeDetailRow(row: {
  id: string;
  key: string;
  name: string;
  subject: string;
  preheader: string | null;
  bodyHtml: string;
  bodyText: string | null;
  isActive: boolean;
  isSystem?: boolean;
  updatedAt: Date;
}): EmailTemplateDetailRow {
  return {
    ...normalizeListRow(row),
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
  };
}

export type EmailTemplateListRow = {
  id: string;
  key: string;
  name: string;
  subject: string;
  preheader: string | null;
  isActive: boolean;
  isSystem: boolean;
  updatedAt: Date;
};

export type EmailTemplateDetailRow = EmailTemplateListRow & {
  bodyHtml: string;
  bodyText: string | null;
};

export function buildDefaultListRows(): EmailTemplateListRow[] {
  const now = new Date();
  return EMAIL_TEMPLATE_KEYS.map((key) => {
    const def = TENANT_EMAIL_TEMPLATE_DEFAULTS[key];
    return {
      id:         `default-${key}`,
      key,
      name:       def.name,
      subject:    def.subject,
      preheader:  def.preheader,
      isActive:   true,
      isSystem:   true,
      updatedAt:  now,
    };
  });
}

export function buildDefaultDetailRow(key: EmailTemplateKey): EmailTemplateDetailRow {
  const def = TENANT_EMAIL_TEMPLATE_DEFAULTS[key];
  const now = new Date();
  return {
    id:         `default-${key}`,
    key,
    name:       def.name,
    subject:    def.subject,
    preheader:  def.preheader,
    bodyHtml:   def.bodyHtml,
    bodyText:   def.bodyText,
    isActive:   true,
    isSystem:   true,
    updatedAt:  now,
  };
}

export function logEmailTemplatesDbFallback(reason: string, err?: unknown): void {
  logger.warn({
    message: '[EmailTemplate] DB kullanılamıyor, varsayılan şablonlar dönülüyor',
    reason,
    error: err instanceof Error ? err.message : undefined,
  });
}
