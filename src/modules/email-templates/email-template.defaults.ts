import type { EmailTemplateKey } from './email-template.keys';
import { EMAIL_TEMPLATE_KEY_LABELS } from './email-template.keys';

export type TenantTemplateDefault = {
  name: string;
  subject: string;
  preheader: string;
  bodyHtml: string;
  bodyText: string;
};

export const TENANT_EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, TenantTemplateDefault> = {
  order_received: {
    name: EMAIL_TEMPLATE_KEY_LABELS.order_received,
    subject: 'Siparişiniz alındı — {{orderNumber}}',
    preheader: 'Siparişiniz oluşturuldu',
    bodyHtml: `<h2>Siparişiniz alındı</h2>
<p>Merhaba {{customerName}}, <strong>{{storeName}}</strong> mağazasından verdiğiniz <strong>{{orderNumber}}</strong> numaralı sipariş kaydedildi.</p>
<p><strong>Toplam:</strong> {{orderTotal}}</p>
<p><strong>Ödeme:</strong> {{paymentMethod}}</p>
<p>Sipariş durumunu hesabınızdan takip edebilirsiniz.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{storeName}} mağazasından {{orderNumber}} numaralı siparişiniz alındı.\nToplam: {{orderTotal}}\nÖdeme: {{paymentMethod}}`,
  },
  payment_success: {
    name: EMAIL_TEMPLATE_KEY_LABELS.payment_success,
    subject: 'Ödemeniz alındı — {{orderNumber}}',
    preheader: 'Ödeme onaylandı',
    bodyHtml: `<h2>Ödemeniz alındı</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz için ödeme onaylandı.</p>
<p><strong>Toplam:</strong> {{orderTotal}}</p>
<p><strong>Ödeme yöntemi:</strong> {{paymentMethod}}</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} siparişiniz için ödeme alındı. Toplam: {{orderTotal}}`,
  },
  payment_failed: {
    name: EMAIL_TEMPLATE_KEY_LABELS.payment_failed,
    subject: 'Ödeme başarısız — {{orderNumber}}',
    preheader: 'Ödeme tamamlanamadı',
    bodyHtml: `<h2>Ödeme tamamlanamadı</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz için ödeme alınamadı.</p>
<p>Lütfen ödeme adımını tekrar deneyin veya farklı bir yöntem seçin.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} siparişi için ödeme başarısız oldu.`,
  },
  bank_transfer_pending: {
    name: EMAIL_TEMPLATE_KEY_LABELS.bank_transfer_pending,
    subject: 'Havale/EFT bekleniyor — {{orderNumber}}',
    preheader: 'Ödeme talimatları',
    bodyHtml: `<h2>Havale / EFT bekleniyor</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz için havale/EFT ödemesi bekleniyor.</p>
<p><strong>Toplam:</strong> {{orderTotal}}</p>
<p>Ödeme açıklamasına sipariş numaranızı yazmayı unutmayın.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} için havale/EFT bekleniyor. Toplam: {{orderTotal}}`,
  },
  order_shipped: {
    name: EMAIL_TEMPLATE_KEY_LABELS.order_shipped,
    subject: 'Siparişiniz kargoya verildi — {{orderNumber}}',
    preheader: 'Kargo yola çıktı',
    bodyHtml: `<h2>Kargoya verildi</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz kargoya verildi.</p>
<p><strong>Takip no:</strong> {{trackingNumber}}</p>
<p><a href="{{trackingUrl}}">Kargo takibi</a></p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} kargoya verildi. Takip: {{trackingNumber}}`,
  },
  order_delivered: {
    name: EMAIL_TEMPLATE_KEY_LABELS.order_delivered,
    subject: 'Siparişiniz teslim edildi — {{orderNumber}}',
    preheader: 'Teslimat tamamlandı',
    bodyHtml: `<h2>Teslim edildi</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz teslim edildi.</p>
<p>Alışverişiniz için teşekkür ederiz.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} teslim edildi.`,
  },
  order_cancelled: {
    name: EMAIL_TEMPLATE_KEY_LABELS.order_cancelled,
    subject: 'Sipariş iptal edildi — {{orderNumber}}',
    preheader: 'Sipariş iptali',
    bodyHtml: `<h2>Sipariş iptal edildi</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> numaralı siparişiniz iptal edildi.</p>
<p>Sorularınız için mağazamızla iletişime geçebilirsiniz.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} iptal edildi.`,
  },
  return_request_received: {
    name: EMAIL_TEMPLATE_KEY_LABELS.return_request_received,
    subject: 'İade talebiniz alındı — {{orderNumber}}',
    preheader: 'İade talebi kaydı',
    bodyHtml: `<h2>İade talebi alındı</h2>
<p>Merhaba {{customerName}}, <strong>{{orderNumber}}</strong> siparişi için iade talebiniz kaydedildi.</p>
<p>Mağaza ekibimiz talebinizi inceleyecektir.</p>`,
    bodyText: `Merhaba {{customerName}},\n\n{{orderNumber}} için iade talebiniz alındı.`,
  },
  password_reset: {
    name: EMAIL_TEMPLATE_KEY_LABELS.password_reset,
    subject: 'Şifre sıfırlama — {{storeName}}',
    preheader: 'Şifre sıfırlama bağlantısı',
    bodyHtml: `<h2>Şifrenizi sıfırlayın</h2>
<p>Merhaba {{customerName}}, <strong>{{storeName}}</strong> hesabınız için şifre sıfırlama talebi aldık.</p>
<p><a href="{{resetLink}}" class="btn">Şifremi Sıfırla</a></p>
<p>Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın.</p>`,
    bodyText: `Merhaba {{customerName}},\n\nŞifre sıfırlama: {{resetLink}}`,
  },
  contact_form_notification: {
    name: EMAIL_TEMPLATE_KEY_LABELS.contact_form_notification,
    subject: 'Yeni iletişim mesajı: {{contactSubject}}',
    preheader: 'Mağaza iletişim formu',
    bodyHtml: `<h2>Yeni iletişim mesajı</h2>
<p><strong>Konu:</strong> {{contactSubject}}</p>
<p><strong>Gönderen:</strong> {{customerName}}</p>
<p>Mesaj paneldeki iletişim kutusunda görüntülenebilir.</p>`,
    bodyText: `Yeni iletişim mesajı — Konu: {{contactSubject}}\nGönderen: {{customerName}}`,
  },
};
