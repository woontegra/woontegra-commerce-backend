import { storeEmailLayout } from './store-layout';
import { escapeHtml, resolveStoreName, type StoreEmailBranding } from './store-email.util';

export type StoreCustomerPasswordResetData = StoreEmailBranding & {
  customerName:      string;
  resetUrl:          string;
  expiresInMinutes:  number;
};

export function storeCustomerPasswordResetTemplate(data: StoreCustomerPasswordResetData) {
  const storeName = escapeHtml(resolveStoreName(data.storeName));
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');

  return {
    subject: `Şifre sıfırlama — ${resolveStoreName(data.storeName)}`,
    html: storeEmailLayout(data, 'Şifre Sıfırlama', `
      <h2>Şifrenizi sıfırlayın</h2>
      <p>Merhaba ${name}, <strong>${storeName}</strong> mağazası hesabınız için şifre sıfırlama talebi aldık.</p>
      <p>Bağlantı <strong>${data.expiresInMinutes} dakika</strong> içinde geçerliliğini yitirir.</p>
      <a href="${escapeHtml(data.resetUrl)}" class="btn">Şifremi Sıfırla</a>
      <p style="font-size:13px;color:#94a3b8">Buton çalışmıyorsa bu adresi tarayıcıya yapıştırın:<br/>
      <a href="${escapeHtml(data.resetUrl)}">${escapeHtml(data.resetUrl)}</a></p>
      <hr class="divider"/>
      <p>Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değiştirilmeyecektir.</p>
    `),
  };
}
