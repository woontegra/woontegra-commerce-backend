import { emailLayout } from './layout';

export interface ErrorAlertTemplateData {
  title: string;
  message: string;
  context?: string;
  tenantId?: string;
  errorCode?: string;
  occurredAt?: Date | string;
  details?: string;
}

export function errorAlertTemplate(data: ErrorAlertTemplateData) {
  const when = data.occurredAt
    ? new Date(data.occurredAt).toLocaleString('tr-TR')
    : new Date().toLocaleString('tr-TR');

  return {
    subject: `[Woontegra] ${data.title}`,
    html: emailLayout('Sistem Bildirimi', `
      <h2>${data.title}</h2>
      <p>${data.message}</p>
      <div class="card">
        ${data.errorCode ? `<div class="card-row"><span class="label">Kod</span><span class="value"><code>${data.errorCode}</code></span></div>` : ''}
        ${data.context ? `<div class="card-row"><span class="label">Bağlam</span><span class="value">${data.context}</span></div>` : ''}
        ${data.tenantId ? `<div class="card-row"><span class="label">Tenant</span><span class="value"><code>${data.tenantId}</code></span></div>` : ''}
        <div class="card-row"><span class="label">Zaman</span><span class="value">${when}</span></div>
      </div>
      ${data.details ? `<p style="font-size:13px;background:#fef2f2;padding:12px;border-radius:8px;color:#991b1b"><pre style="margin:0;white-space:pre-wrap;font-family:monospace;font-size:12px">${escapeHtml(data.details)}</pre></p>` : ''}
      <span class="badge-amber">Operasyonel Uyarı</span>
    `),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function errorAlertTemplateSample() {
  return errorAlertTemplate({
    title: 'Trendyol senkron hatası',
    message: 'Fiyat/stok güncellemesi başarısız oldu.',
    context: 'trendyol.sync-queue',
    errorCode: 'TRENDYOL_BATCH_TIMEOUT',
    tenantId: 'tenant-uuid-sample',
    details: 'Batch request 504 after 120s',
  });
}
