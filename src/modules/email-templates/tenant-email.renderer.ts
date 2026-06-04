import { storeEmailLayout } from '../email/templates/store-layout';
import {
  escapeHtml,
  resolveStoreName,
  type StoreEmailBranding,
} from '../email/templates/store-email.util';
import type { EmailTemplateKey } from './email-template.keys';
import { TENANT_EMAIL_TEMPLATE_DEFAULTS } from './email-template.defaults';
import {
  buildTemplateVariables,
  interpolateTemplateString,
} from './email-template.variables';

export type TenantRenderedEmail = { subject: string; html: string; text?: string };

function brandingFromData(data: Record<string, unknown>): StoreEmailBranding {
  return {
    storeName:  typeof data.storeName === 'string' ? data.storeName : undefined,
    logoUrl:    typeof data.logoUrl === 'string' ? data.logoUrl : null,
    tenantSlug: typeof data.tenantSlug === 'string' ? data.tenantSlug : '',
  };
}

export function renderTenantCustomEmail(
  _key: EmailTemplateKey | string,
  row: {
    subject: string;
    preheader?: string | null;
    bodyHtml: string;
    bodyText?: string | null;
  },
  templateData: Record<string, unknown>,
): TenantRenderedEmail {
  const vars = buildTemplateVariables(templateData);
  const branding = brandingFromData(templateData);
  const title = interpolateTemplateString(row.subject, vars);
  const innerHtml = interpolateTemplateString(row.bodyHtml, vars);
  const preheader = row.preheader
    ? interpolateTemplateString(row.preheader, vars)
    : '';

  const preheaderBlock = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>`
    : '';

  const html = storeEmailLayout(
    branding,
    resolveStoreName(branding.storeName),
    `${preheaderBlock}${innerHtml}`,
  );

  const text = row.bodyText
    ? interpolateTemplateString(row.bodyText, vars)
    : undefined;

  return { subject: title, html, text };
}

export function renderTenantDefaultContactEmail(
  templateData: Record<string, unknown>,
): TenantRenderedEmail {
  const def = TENANT_EMAIL_TEMPLATE_DEFAULTS.contact_form_notification;
  return renderTenantCustomEmail('contact_form_notification', def, templateData);
}
