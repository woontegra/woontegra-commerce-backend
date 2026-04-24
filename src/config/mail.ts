import nodemailer from 'nodemailer';
import { config } from './env';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    email: string;
  };
}

export const mailConfig: MailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  from: {
    name: process.env.MAIL_FROM_NAME || 'Woontegra',
    email: process.env.MAIL_FROM_EMAIL || 'noreply@woontegra.com',
  },
};

// Create reusable transporter
export const createMailTransporter = () => {
  if (!mailConfig.auth.user || !mailConfig.auth.pass) {
    console.warn('[Mail] SMTP credentials not configured. Emails will not be sent.');
    return null;
  }

  return nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.auth.user,
      pass: mailConfig.auth.pass,
    },
  });
};

export const transporter = createMailTransporter();
