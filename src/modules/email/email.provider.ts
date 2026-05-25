import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../../config/logger';
import {
  assertEmailConfiguredForSend,
  getEmailApiKey,
  getEmailFrom,
  getEmailProvider,
  getSmtpConfig,
  isEmailDeliveryConfigured,
} from './email.config';

export interface SendMailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter {
  if (smtpTransporter) return smtpTransporter;

  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass) {
    logger.warn({ message: '[Email] SMTP not configured — using jsonTransport (dev log only)' });
    smtpTransporter = nodemailer.createTransport({ jsonTransport: true } as nodemailer.TransportOptions);
    return smtpTransporter;
  }

  smtpTransporter = nodemailer.createTransport({
    host:   smtp.host,
    port:   smtp.port,
    secure: smtp.secure,
    auth:   { user: smtp.user, pass: smtp.pass },
    tls:    { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });
  return smtpTransporter;
}

async function sendViaResend(payload: SendMailPayload, from: { name: string; email: string }): Promise<string> {
  const apiKey = getEmailApiKey();
  if (!apiKey) {
    throw new Error('EMAIL_API_KEY tanımlı değil (Resend).');
  }

  const fromHeader = payload.from || `${from.name} <${from.email}>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    fromHeader,
      to:      [payload.to],
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    }),
  });

  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };

  if (!res.ok) {
    throw new Error(body.message || `Resend API hatası: HTTP ${res.status}`);
  }

  return body.id || 'resend-ok';
}

async function sendViaSmtp(payload: SendMailPayload, from: { name: string; email: string }): Promise<string> {
  const transport = getSmtpTransporter();
  const fromHeader = payload.from || `"${from.name}" <${from.email}>`;

  const info = await transport.sendMail({
    from:    fromHeader,
    to:      payload.to,
    subject: payload.subject,
    html:    payload.html,
    text:    payload.text,
  });

  if ((transport as { options?: { jsonTransport?: boolean } }).options?.jsonTransport) {
    logger.info({
      message: '[Email] (jsonTransport — not delivered)',
      to:      payload.to,
      subject: payload.subject,
    });
  }

  return info.messageId || 'smtp-ok';
}

/**
 * Gerçek e-posta gönderimi (kuyruk worker tarafından çağrılır).
 * Yapılandırma yoksa development'ta log-only; production'da hata fırlatır.
 */
export async function deliverEmail(payload: SendMailPayload): Promise<{ messageId: string }> {
  const from = getEmailFrom();

  if (!isEmailDeliveryConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      assertEmailConfiguredForSend();
    }
    logger.warn({
      message: '[Email] Delivery skipped — not configured',
      to:      payload.to,
      subject: payload.subject,
    });
    return { messageId: 'skipped-not-configured' };
  }

  const provider = getEmailProvider();
  let messageId: string;

  if (provider === 'resend') {
    messageId = await sendViaResend(payload, from);
  } else {
    messageId = await sendViaSmtp(payload, from);
  }

  logger.info({ message: '[Email] Delivered', provider, to: payload.to, subject: payload.subject, messageId });
  return { messageId };
}
