export type EmailProviderType = 'resend' | 'smtp' | 'nodemailer';

export function getEmailProvider(): EmailProviderType {
  const raw = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
  if (raw === 'resend') return 'resend';
  return 'smtp';
}

export function getEmailApiKey(): string | undefined {
  return process.env.EMAIL_API_KEY?.trim() || undefined;
}

export function getEmailFrom(): { name: string; email: string } {
  const email = process.env.EMAIL_FROM?.trim()
    || process.env.EMAIL_FROM_EMAIL?.trim()
    || 'noreply@woontegra.com';
  const name = process.env.EMAIL_FROM_NAME?.trim() || 'Woontegra';
  return { name, email };
}

export function getSmtpConfig() {
  return {
    host: process.env.EMAIL_HOST?.trim() || process.env.SMTP_HOST?.trim(),
    port: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10),
    user: process.env.EMAIL_USER?.trim() || process.env.SMTP_USER?.trim(),
    pass: getEmailApiKey() || process.env.SMTP_PASS?.trim(),
    secure: (process.env.EMAIL_SECURE || '').toLowerCase() === 'true'
      || parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10) === 465,
  };
}

/** Production gönderimi için minimum yapılandırma */
export function isEmailDeliveryConfigured(): boolean {
  const provider = getEmailProvider();
  if (provider === 'resend') {
    return Boolean(getEmailApiKey() && getEmailFrom().email);
  }
  const smtp = getSmtpConfig();
  return Boolean(smtp.host && smtp.user && smtp.pass);
}

export function assertEmailConfiguredForSend(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!isEmailDeliveryConfigured()) {
    throw new Error(
      'E-posta yapılandırması eksik. EMAIL_PROVIDER, EMAIL_API_KEY ve gönderen adresini (.env) tanımlayın.',
    );
  }
}
