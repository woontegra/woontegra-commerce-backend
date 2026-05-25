import { emailLayout, frontendUrl } from './layout';

export interface SubscriptionNotificationData {
  tenantName: string;
  plan: string;
  billingCycle?: string;
  endDate?: Date | string;
  amount?: number;
  currency?: string;
  status?: 'activated' | 'canceled' | 'payment_success' | 'payment_failed';
  reason?: string;
}

function formatDate(d: Date | string | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('tr-TR');
}

function cycleLabel(cycle?: string): string {
  if (!cycle) return '—';
  return cycle === 'MONTHLY' || cycle === 'monthly' ? 'Aylık' : cycle === 'YEARLY' ? 'Yıllık' : cycle;
}

export function subscriptionNotificationTemplate(data: SubscriptionNotificationData) {
  const status = data.status ?? 'activated';

  if (status === 'payment_failed') {
    return {
      subject: `Ödeme başarısız — ${data.plan} planı`,
      html: emailLayout('Ödeme Başarısız', `
        <h2>Ödemeniz gerçekleşmedi</h2>
        <p><strong>${data.tenantName}</strong> hesabınız için ödeme tamamlanamadı.</p>
        <div class="card">
          <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
          ${data.amount != null ? `<div class="card-row"><span class="label">Tutar</span><span class="value">${data.amount} ${data.currency || 'TRY'}</span></div>` : ''}
          ${data.reason ? `<div class="card-row"><span class="label">Sebep</span><span class="value" style="color:#dc2626">${data.reason}</span></div>` : ''}
        </div>
        <span class="badge-red">Başarısız</span>
        <a href="${frontendUrl('/dashboard/billing')}" class="btn">Tekrar Dene</a>
      `),
    };
  }

  if (status === 'payment_success') {
    return {
      subject: `Ödemeniz alındı — ${data.plan}`,
      html: emailLayout('Ödeme Onayı', `
        <h2>Ödemeniz alındı</h2>
        <p><strong>${data.tenantName}</strong> için ödeme onaylandı.</p>
        <div class="card">
          <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
          <div class="card-row"><span class="label">Dönem</span><span class="value">${cycleLabel(data.billingCycle)}</span></div>
          ${data.amount != null ? `<div class="card-row"><span class="label">Tutar</span><span class="value">${data.amount} ${data.currency || 'TRY'}</span></div>` : ''}
        </div>
        <span class="badge-green">Başarılı</span>
      `),
    };
  }

  if (status === 'canceled') {
    return {
      subject: 'Aboneliğiniz iptal edildi',
      html: emailLayout('Abonelik İptal', `
        <h2>Abonelik iptal edildi</h2>
        <p><strong>${data.tenantName}</strong> — <strong>${data.plan}</strong> planınız iptal edildi.</p>
        <p>Bitiş: <strong>${formatDate(data.endDate)}</strong></p>
        <a href="${frontendUrl('/plans')}" class="btn">Planları Görüntüle</a>
      `),
    };
  }

  return {
    subject: `${data.plan} planınız aktifleşti`,
    html: emailLayout('Abonelik Aktif', `
      <h2>${data.plan} planınız aktif</h2>
      <p>Merhaba <strong>${data.tenantName}</strong>, aboneliğiniz başarıyla başlatıldı.</p>
      <div class="card">
        <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
        <div class="card-row"><span class="label">Dönem</span><span class="value">${cycleLabel(data.billingCycle)}</span></div>
        <div class="card-row"><span class="label">Bitiş</span><span class="value">${formatDate(data.endDate)}</span></div>
      </div>
      <span class="badge-green">Aktif</span>
      <a href="${frontendUrl('/dashboard')}" class="btn">Panele Git</a>
    `),
  };
}
