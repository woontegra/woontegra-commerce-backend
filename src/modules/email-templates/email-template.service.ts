import prisma from '../../config/database';
import { logger } from '../../config/logger';
import { renderEmailTemplate, type TemplateKey } from '../email/templates';
import type { EmailJobData } from '../../queues/email-job.types';
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_KEY_LABELS,
  EMAIL_TEMPLATE_VARIABLES,
  isEmailTemplateKey,
  resolveTenantKeyFromSystem,
  type EmailTemplateKey,
} from './email-template.keys';
import { TENANT_EMAIL_TEMPLATE_DEFAULTS } from './email-template.defaults';
import {
  renderTenantCustomEmail,
  renderTenantDefaultContactEmail,
} from './tenant-email.renderer';
import {
  generateUniqueCustomTemplateCode,
  isCustomTemplateKey,
  normalizeCustomTemplateCode,
} from './email-template.code.util';
import {
  buildDefaultDetailRow,
  buildDefaultListRows,
  getEmailTemplateDelegate,
  isEmailTemplatesDbUnavailable,
  isEmailTemplatesTableMissing,
  logEmailTemplatesDbFallback,
  normalizeDetailRow,
  normalizeListRow,
  type EmailTemplateDetailRow,
  type EmailTemplateListRow,
} from './email-template.db';
import { ensureEmailTemplatesSchema } from './email-template.schema-sync';

export { EMAIL_TEMPLATE_VARIABLES };

function mapListRow(r: EmailTemplateListRow) {
  const n = normalizeListRow(r);
  return {
    ...n,
    canDelete: !n.isSystem,
  };
}

function mapDetailRow(r: EmailTemplateDetailRow) {
  const n = normalizeDetailRow(r);
  return {
    ...n,
    canDelete: !n.isSystem,
  };
}

async function loadTenantTemplateRows(
  tenantId: string,
): Promise<EmailTemplateListRow[] | null> {
  const db = getEmailTemplateDelegate();
  if (!db) return null;

  await ensureEmailTemplatesSchema();

  try {
    return await db.findMany({
      where: { tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  } catch (err) {
    if (!isEmailTemplatesDbUnavailable(err)) throw err;
    try {
      return await db.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      });
    } catch (retryErr) {
      if (!isEmailTemplatesDbUnavailable(retryErr)) throw retryErr;
      return null;
    }
  }
}

function parseContentFields(body: {
  subject?: string;
  preheader?: string | null;
  bodyHtml?: string;
  bodyText?: string | null;
  isActive?: boolean;
}) {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml.trim() : '';
  if (!subject) throw new Error('Konu zorunludur.');
  if (!bodyHtml) throw new Error('HTML içerik zorunludur.');

  const preheader =
    body.preheader === null || body.preheader === undefined
      ? null
      : String(body.preheader).trim() || null;
  const bodyText =
    body.bodyText === null || body.bodyText === undefined
      ? null
      : String(body.bodyText).trim() || null;

  return {
    subject,
    preheader,
    bodyHtml,
    bodyText,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
  };
}

export class EmailTemplateService {
  async ensureSeeded(tenantId: string): Promise<boolean> {
    const db = getEmailTemplateDelegate();
    if (!db) return false;

    await ensureEmailTemplatesSchema();

    try {
      const existing =
        (await loadTenantTemplateRows(tenantId)) ??
        (await db.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }));
      const have = new Set(existing.map((r) => r.key));

      for (const key of EMAIL_TEMPLATE_KEYS) {
        if (have.has(key)) continue;
        const def = TENANT_EMAIL_TEMPLATE_DEFAULTS[key];
        const payload = {
          tenantId,
          key,
          name:      def.name,
          subject:   def.subject,
          preheader: def.preheader,
          bodyHtml:  def.bodyHtml,
          bodyText:  def.bodyText,
          isActive:  true,
          isSystem:  true,
        };
        try {
          await db.create({ data: payload });
        } catch (createErr) {
          if (!isEmailTemplatesDbUnavailable(createErr)) throw createErr;
          const { isSystem: _s, ...legacy } = payload;
          try {
            await db.create({ data: legacy });
          } catch {
            return false;
          }
        }
      }

      try {
        await db.updateMany({
          where: { tenantId, key: { in: [...EMAIL_TEMPLATE_KEYS] } },
          data: { isSystem: true },
        });
      } catch {
        /* isSystem sütunu yoksa atla */
      }

      return true;
    } catch (err) {
      logEmailTemplatesDbFallback('ensureSeeded', err);
      await ensureEmailTemplatesSchema();
      return false;
    }
  }

  async listForTenant(tenantId: string) {
    const db = getEmailTemplateDelegate();
    if (!db) {
      logEmailTemplatesDbFallback('prisma_delegate_missing');
      return buildDefaultListRows().map(mapListRow);
    }

    try {
      await this.ensureSeeded(tenantId);
      const rows = await loadTenantTemplateRows(tenantId);
      if (rows && rows.length > 0) {
        return rows.map(mapListRow);
      }
    } catch (err) {
      logEmailTemplatesDbFallback('listForTenant', err);
    }

    return buildDefaultListRows().map(mapListRow);
  }

  async getByKey(tenantId: string, key: string) {
    const db = getEmailTemplateDelegate();
    if (!db) {
      if (isEmailTemplateKey(key)) {
        logEmailTemplatesDbFallback('prisma_delegate_missing');
        return mapDetailRow(buildDefaultDetailRow(key));
      }
      return null;
    }

    try {
      await this.ensureSeeded(tenantId);
      const row = await db.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      if (row) return mapDetailRow(row);
    } catch (err) {
      if (!isEmailTemplatesDbUnavailable(err)) throw err;
      logEmailTemplatesDbFallback('getByKey', err);
      if (isEmailTemplateKey(key)) {
        return mapDetailRow(buildDefaultDetailRow(key));
      }
      return null;
    }

    if (isEmailTemplateKey(key)) {
      return mapDetailRow(buildDefaultDetailRow(key));
    }
    return null;
  }

  async createCustom(
    tenantId: string,
    body: {
      name?: string;
      templateCode?: string;
      subject?: string;
      preheader?: string | null;
      bodyHtml?: string;
      bodyText?: string | null;
      isActive?: boolean;
    },
  ) {
    const db = getEmailTemplateDelegate();
    if (!db) {
      throw new Error(
        'E-posta şablonları veritabanı hazır değil. Sunucuda prisma generate ve migrate deploy çalıştırın.',
      );
    }

    await ensureEmailTemplatesSchema();
    const seeded = await this.ensureSeeded(tenantId);
    if (!seeded) {
      throw new Error(
        'email_templates tablosu bulunamadı. Veritabanında migration uygulayın: npx prisma migrate deploy',
      );
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new Error('Şablon adı zorunludur.');

    const content = parseContentFields(body);

    let key: string | null = null;
    if (typeof body.templateCode === 'string' && body.templateCode.trim()) {
      key = normalizeCustomTemplateCode(body.templateCode);
      if (!key) {
        throw new Error(
          'Geçersiz şablon kodu. Yalnızca küçük harf, rakam ve alt çizgi kullanın (ör. kampanya_hosgeldin).',
        );
      }
      const taken = await db.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      if (taken) throw new Error('Bu şablon kodu zaten kullanılıyor.');
    } else {
      key = await generateUniqueCustomTemplateCode(tenantId, name, async (candidate) => {
        const row = await db.findUnique({
          where: { tenantId_key: { tenantId, key: candidate } },
        });
        return row != null;
      });
    }

    const row = await db.create({
      data: {
        tenantId,
        key,
        name,
        subject:   content.subject,
        preheader: content.preheader,
        bodyHtml:  content.bodyHtml,
        bodyText:  content.bodyText,
        isActive:  content.isActive,
        isSystem:  false,
      },
    });

    return mapDetailRow(row);
  }

  async update(
    tenantId: string,
    key: string,
    body: {
      name?: string;
      subject?: string;
      preheader?: string | null;
      bodyHtml?: string;
      bodyText?: string | null;
      isActive?: boolean;
    },
  ) {
    const db = getEmailTemplateDelegate();
    if (!db) {
      throw new Error(
        'E-posta şablonları veritabanı hazır değil. Sunucuda prisma generate ve migrate deploy çalıştırın.',
      );
    }

    const seeded = await this.ensureSeeded(tenantId);
    if (!seeded) {
      throw new Error(
        'email_templates tablosu bulunamadı. Veritabanında migration uygulayın: npx prisma migrate deploy',
      );
    }

    const existing = await db.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!existing) {
      throw new Error('Şablon bulunamadı.');
    }

    const content = parseContentFields(body);
    const data: Record<string, unknown> = {
      subject:   content.subject,
      preheader: content.preheader,
      bodyHtml:  content.bodyHtml,
      bodyText:  content.bodyText,
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
    };

    if (!existing.isSystem && typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim();
    }

    const row = await db.update({
      where: { tenantId_key: { tenantId, key } },
      data,
    });

    return mapDetailRow(row);
  }

  async deleteCustom(tenantId: string, key: string): Promise<void> {
    if (!isCustomTemplateKey(key)) {
      throw new Error('Sistem şablonları silinemez.');
    }

    const db = getEmailTemplateDelegate();
    if (!db) {
      throw new Error('E-posta şablonları veritabanı hazır değil.');
    }

    const existing = await db.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!existing) {
      throw new Error('Şablon bulunamadı.');
    }
    if (existing.isSystem) {
      throw new Error('Sistem şablonları silinemez.');
    }

    await db.delete({
      where: { tenantId_key: { tenantId, key } },
    });
  }

  async resolveActiveTemplate(
    tenantId: string,
    tenantKey: EmailTemplateKey,
    templateData: Record<string, unknown>,
  ) {
    const db = getEmailTemplateDelegate();
    if (!db) return null;

    try {
      const row = await db.findUnique({
        where: { tenantId_key: { tenantId, key: tenantKey } },
      });
      if (!row?.isActive) return null;
      return renderTenantCustomEmail(tenantKey, row, templateData);
    } catch (err) {
      if (isEmailTemplatesTableMissing(err)) return null;
      throw err;
    }
  }
}

const svc = new EmailTemplateService();

/** Kuyruk işi için önce kiracı şablonu, yoksa sistem varsayılanı */
export async function resolveQueuedEmail(
  data: EmailJobData,
): Promise<{ subject: string; html: string; text?: string }> {
  const templateData = data.templateData ?? {};

  if (data.tenantId) {
    const tenantKey =
      data.tenantTemplateKey ??
      (data.template ? resolveTenantKeyFromSystem(data.template, templateData) : null);

    if (tenantKey) {
      try {
        const custom = await svc.resolveActiveTemplate(
          data.tenantId,
          tenantKey,
          templateData,
        );
        if (custom) {
          return { subject: custom.subject, html: custom.html, text: custom.text ?? data.text };
        }
      } catch (err) {
        logger.warn({
          message: '[EmailTemplate] Kiracı şablonu çözülemedi, varsayılan kullanılıyor',
          tenantId: data.tenantId,
          tenantKey,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    if (data.tenantTemplateKey === 'contact_form_notification' && !data.template) {
      return renderTenantDefaultContactEmail(templateData);
    }
  }

  if (data.template) {
    const rendered = renderEmailTemplate(data.template as TemplateKey, templateData);
    return { subject: rendered.subject, html: rendered.html, text: data.text };
  }

  if (!data.subject || !data.html) {
    throw new Error('E-posta işi: template veya subject+html zorunludur.');
  }

  return {
    subject: data.subject,
    html: data.html,
    text: data.text,
  };
}

async function resolveStoreOwnerEmail(tenantId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { tenantId, role: 'OWNER', isActive: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  });
  if (owner?.email?.trim()) return owner.email.trim();

  const admin = await prisma.user.findFirst({
    where: { tenantId, isActive: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  });
  return admin?.email?.trim() || null;
}

/** İletişim formu — mağaza sahibine bildirim (hata fırlatmaz) */
export async function queueContactFormNotification(
  tenantId: string,
  payload: {
    storeName: string;
    tenantSlug: string;
    logoUrl?: string | null;
    name: string;
    email: string;
    subject: string;
    message: string;
  },
): Promise<void> {
  try {
    const to = await resolveStoreOwnerEmail(tenantId);
    if (!to) {
      logger.warn({ message: '[EmailTemplate] İletişim bildirimi atlandı — alıcı yok', tenantId });
      return;
    }

    const { sendEmailAsync } = await import('../../queues/email.queue');
    await sendEmailAsync({
      to,
      tenantId,
      tenantTemplateKey: 'contact_form_notification',
      templateData: {
        storeName:      payload.storeName,
        logoUrl:        payload.logoUrl ?? null,
        tenantSlug:     payload.tenantSlug,
        customerName:   payload.name,
        contactSubject: payload.subject,
        contactEmail:   payload.email,
        contactMessage: payload.message,
      },
    });
  } catch (error) {
    logger.error({
      message: '[EmailTemplate] queueContactFormNotification failed',
      tenantId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export function getTemplateMeta() {
  return {
    keys: EMAIL_TEMPLATE_KEYS.map((key) => ({
      key,
      name: EMAIL_TEMPLATE_KEY_LABELS[key],
    })),
    variables: EMAIL_TEMPLATE_VARIABLES,
  };
}
