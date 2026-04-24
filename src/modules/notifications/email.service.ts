import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../../config/logger';

// ─── Config ───────────────────────────────────────────────────────────────────

function buildTransporter(): Transporter {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Fallback: Ethereal test account in dev (auto-creates account)
  if (!host || !user) {
    logger.warn({ message: '[Email] SMTP not configured — emails will be logged only' });
    return nodemailer.createTransport({ jsonTransport: true } as any);
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls:  { rejectUnauthorized: false },
  });
}

const transporter = buildTransporter();
const FROM_NAME  = process.env.EMAIL_FROM_NAME  || 'Woontegra';
const FROM_EMAIL = process.env.EMAIL_FROM_EMAIL || 'noreply@woontegra.com';

// ─── Base HTML layout ─────────────────────────────────────────────────────────

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width:600px; margin:32px auto; }
    .header  { background:#1e40af; padding:28px 32px; border-radius:12px 12px 0 0; text-align:center; }
    .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; letter-spacing:-0.3px; }
    .body    { background:#fff; padding:32px; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; }
    .footer  { background:#f8fafc; border:1px solid #e2e8f0; border-top:none; padding:16px 32px; border-radius:0 0 12px 12px; text-align:center; }
    .footer p { margin:0; color:#94a3b8; font-size:12px; }
    h2  { margin:0 0 8px; color:#0f172a; font-size:22px; font-weight:700; }
    p   { margin:0 0 16px; color:#475569; line-height:1.6; font-size:15px; }
    .btn { display:inline-block; background:#1e40af; color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:14px; margin:8px 0 16px; }
    .card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin:16px 0; }
    .card-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e2e8f0; font-size:14px; }
    .card-row:last-child { border-bottom:none; }
    .label { color:#64748b; }
    .value { color:#0f172a; font-weight:600; }
    .badge-green  { display:inline-block; background:#dcfce7; color:#15803d; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .badge-red    { display:inline-block; background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .badge-amber  { display:inline-block; background:#fef9c3; color:#b45309; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .divider { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>🚀 Woontegra</h1></div>
    <div class="body">${body}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Woontegra. Tüm hakları saklıdır.</p>
      <p>Bu e-posta otomatik olarak gönderilmiştir, lütfen yanıtlamayınız.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export const templates = {

  ORDER_CREATED: (data: {
    customerName: string; orderNumber: string; totalAmount: number;
    currency: string; items: Array<{ name: string; quantity: number; price: number }>;
  }) => ({
    subject: `Siparişiniz alındı — #${data.orderNumber}`,
    html: layout('Sipariş Onayı', `
      <h2>Siparişiniz alındı! 🎉</h2>
      <p>Merhaba ${data.customerName}, <strong>#${data.orderNumber}</strong> numaralı siparişiniz başarıyla alındı.</p>
      <div class="card">
        ${data.items.map(i => `
          <div class="card-row">
            <span class="label">${i.name} × ${i.quantity}</span>
            <span class="value">${i.price.toFixed(2)} ${data.currency}</span>
          </div>
        `).join('')}
        <div class="card-row">
          <span class="label"><b>Toplam</b></span>
          <span class="value">${data.totalAmount.toFixed(2)} ${data.currency}</span>
        </div>
      </div>
      <p>Siparişinizin durumunu takip etmek için hesabınıza giriş yapabilirsiniz.</p>
    `),
  }),

  PAYMENT_SUCCESS: (data: {
    tenantName: string; plan: string; billingCycle: string;
    amount: number; currency: string; invoiceNumber?: string;
  }) => ({
    subject: `Ödemeniz alındı — ${data.plan} Planı`,
    html: layout('Ödeme Onayı', `
      <h2>Ödemeniz başarıyla alındı ✅</h2>
      <p>Merhaba, <strong>${data.tenantName}</strong> hesabınız için ödeme onaylandı.</p>
      <div class="card">
        <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
        <div class="card-row"><span class="label">Dönem</span><span class="value">${data.billingCycle === 'MONTHLY' ? 'Aylık' : 'Yıllık'}</span></div>
        <div class="card-row"><span class="label">Tutar</span><span class="value">${data.amount.toFixed(2)} ${data.currency}</span></div>
        ${data.invoiceNumber ? `<div class="card-row"><span class="label">Fatura No</span><span class="value">${data.invoiceNumber}</span></div>` : ''}
      </div>
      <span class="badge-green">Ödeme Başarılı</span>
      <hr class="divider"/>
      <p>Hesabınız aktifleştirildi. İyi satışlar! 🎯</p>
    `),
  }),

  PAYMENT_FAILED: (data: {
    tenantName: string; plan: string; amount: number;
    currency: string; reason: string;
  }) => ({
    subject: `Ödeme başarısız — ${data.plan} Planı`,
    html: layout('Ödeme Başarısız', `
      <h2>Ödemeniz gerçekleşmedi ❌</h2>
      <p>Merhaba, <strong>${data.tenantName}</strong> hesabınız için ödeme işlemi tamamlanamadı.</p>
      <div class="card">
        <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
        <div class="card-row"><span class="label">Tutar</span><span class="value">${data.amount.toFixed(2)} ${data.currency}</span></div>
        <div class="card-row"><span class="label">Hata</span><span class="value" style="color:#dc2626">${data.reason}</span></div>
      </div>
      <span class="badge-red">Ödeme Başarısız</span>
      <hr class="divider"/>
      <p>Lütfen ödeme bilgilerinizi kontrol ederek tekrar deneyin.</p>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/plans" class="btn">Tekrar Dene</a>
    `),
  }),

  SUBSCRIPTION_ACTIVATED: (data: {
    tenantName: string; plan: string; billingCycle: string; endDate: Date;
  }) => ({
    subject: `${data.plan} planınız aktifleşti 🎉`,
    html: layout('Abonelik Aktif', `
      <h2>${data.plan} planınız aktifleşti!</h2>
      <p>Merhaba <strong>${data.tenantName}</strong>, aboneliğiniz başarıyla başlatıldı.</p>
      <div class="card">
        <div class="card-row"><span class="label">Plan</span><span class="value">${data.plan}</span></div>
        <div class="card-row"><span class="label">Dönem</span><span class="value">${data.billingCycle === 'MONTHLY' ? 'Aylık' : 'Yıllık'}</span></div>
        <div class="card-row"><span class="label">Bitiş Tarihi</span><span class="value">${data.endDate.toLocaleDateString('tr-TR')}</span></div>
      </div>
      <span class="badge-green">Aktif</span>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" class="btn">Panele Git</a>
    `),
  }),

  SUBSCRIPTION_CANCELED: (data: {
    tenantName: string; plan: string; endDate: Date;
  }) => ({
    subject: `Aboneliğiniz iptal edildi`,
    html: layout('Abonelik İptal', `
      <h2>Aboneliğiniz iptal edildi</h2>
      <p>Merhaba <strong>${data.tenantName}</strong>, <strong>${data.plan}</strong> planınız iptal edildi.</p>
      <p>Aboneliğiniz <strong>${data.endDate.toLocaleDateString('tr-TR')}</strong> tarihine kadar aktif kalmaya devam edecek.</p>
      <hr class="divider"/>
      <p>Geri dönmek ister misiniz?</p>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/plans" class="btn">Planları Görüntüle</a>
    `),
  }),

  TRIAL_ENDING_SOON: (data: {
    tenantName: string; daysLeft: number; trialEndsAt: Date;
  }) => ({
    subject: `Deneme süreniz ${data.daysLeft} gün içinde sona eriyor ⏰`,
    html: layout('Deneme Süresi Bitiyor', `
      <h2>Deneme süreniz bitiyor ⏰</h2>
      <p>Merhaba <strong>${data.tenantName}</strong>,</p>
      <p>Woontegra deneme sürenizin bitmesine <strong>${data.daysLeft} gün</strong> kaldı (<strong>${data.trialEndsAt.toLocaleDateString('tr-TR')}</strong>).</p>
      <span class="badge-amber">${data.daysLeft} Gün Kaldı</span>
      <hr class="divider"/>
      <p>Kesintisiz devam etmek için bir plan seçin.</p>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/plans" class="btn">Plan Seç</a>
    `),
  }),

  TRIAL_EXPIRED: (data: { tenantName: string }) => ({
    subject: `Deneme süreniz sona erdi`,
    html: layout('Deneme Süresi Doldu', `
      <h2>Deneme süreniz sona erdi</h2>
      <p>Merhaba <strong>${data.tenantName}</strong>,</p>
      <p>Woontegra deneme süreniz doldu. Ürünlerinizi, siparişlerinizi ve müşterilerinizi yönetmeye devam etmek için bir plan seçin.</p>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/plans" class="btn">Plan Seç</a>
    `),
  }),

  STOCK_LOW: (data: {
    productName: string; currentQty: number; threshold: number;
  }) => ({
    subject: `Düşük stok uyarısı: ${data.productName}`,
    html: layout('Stok Uyarısı', `
      <h2>Düşük stok uyarısı ⚠️</h2>
      <p><strong>${data.productName}</strong> ürününde stok kritik seviyeye düştü.</p>
      <div class="card">
        <div class="card-row"><span class="label">Mevcut Stok</span><span class="value" style="color:#dc2626">${data.currentQty}</span></div>
        <div class="card-row"><span class="label">Uyarı Eşiği</span><span class="value">${data.threshold}</span></div>
      </div>
      <span class="badge-red">Kritik Stok</span>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/products" class="btn">Stoğu Güncelle</a>
    `),
  }),

};

export type TemplateKey = keyof typeof templates;

// ─── EmailService ─────────────────────────────────────────────────────────────

export class EmailService {
  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const info = await transporter.sendMail({
        from:    `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        html,
      });

      // In dev with jsonTransport, log the email content
      if ((transporter.options as any).jsonTransport) {
        logger.info({ message: '[Email] (dev mode, not sent)', to, subject, preview: html.slice(0, 200) });
      } else {
        logger.info({ message: '[Email] Sent', to, subject, messageId: info.messageId });
      }
    } catch (err) {
      logger.error({ message: '[Email] Send failed', to, subject, err });
      // Non-blocking: swallow error so notification failures don't crash the main flow
    }
  }

  async sendTemplate<K extends TemplateKey>(
    to:   string,
    key:  K,
    data: Parameters<typeof templates[K]>[0],
  ): Promise<void> {
    const tpl = (templates[key] as Function)(data) as { subject: string; html: string };
    await this.send(to, tpl.subject, tpl.html);
  }
}

export const emailService = new EmailService();
