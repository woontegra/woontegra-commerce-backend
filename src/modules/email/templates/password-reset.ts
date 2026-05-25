import { emailLayout, frontendUrl } from './layout';

export interface PasswordResetTemplateData {
  userName?: string;
  resetUrl: string;
  expiresInMinutes?: number;
}

export function passwordResetTemplate(data: PasswordResetTemplateData) {
  const name = data.userName?.trim() || 'Merhaba';
  const mins = data.expiresInMinutes ?? 60;
  return {
    subject: 'Şifre sıfırlama talebi — Woontegra',
    html: emailLayout('Şifre Sıfırlama', `
      <h2>Şifrenizi sıfırlayın</h2>
      <p>${name}, hesabınız için şifre sıfırlama talebi aldık.</p>
      <p>Bağlantı <strong>${mins} dakika</strong> içinde geçerliliğini yitirir.</p>
      <a href="${data.resetUrl}" class="btn">Şifremi Sıfırla</a>
      <p style="font-size:13px;color:#94a3b8">Buton çalışmıyorsa bu adresi tarayıcıya yapıştırın:<br/>
      <a href="${data.resetUrl}">${data.resetUrl}</a></p>
      <hr class="divider"/>
      <p>Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
    `),
  };
}

/** Örnek veri ile önizleme */
export function passwordResetTemplateSample() {
  return passwordResetTemplate({
    userName: 'Demo Kullanıcı',
    resetUrl: frontendUrl('/reset-password?token=sample-token'),
    expiresInMinutes: 60,
  });
}
