import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { transporter, mailConfig } from '../config/mail';
import { logger } from '../config/logger';

interface MailOptions {
  to: string;
  subject: string;
  template: string;
  data: Record<string, any>;
}

interface OrderReceivedData {
  customerName: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  items: Array<{
    name: string;
    quantity: number;
    price: string;
    total: string;
  }>;
  orderTotal: string;
  shippingAddress: {
    fullName: string;
    address: string;
    city: string;
    postalCode: string;
    phone: string;
  };
  orderUrl: string;
  supportEmail: string;
  storeName: string;
}

interface OrderShippedData {
  customerName: string;
  orderNumber: string;
  trackingNumber: string;
  shippingCompany: string;
  shippingDate: string;
  estimatedDelivery: string;
  shippingAddress: {
    fullName: string;
    address: string;
    city: string;
    postalCode: string;
    phone: string;
  };
  trackingUrl: string;
  orderUrl: string;
  supportEmail: string;
  storeName: string;
}

class MailService {
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  /**
   * Load and compile email template
   */
  private async loadTemplate(templateName: string): Promise<HandlebarsTemplateDelegate> {
    // Check cache
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    // Load template file
    const templatePath = path.join(
      __dirname,
      '..',
      'templates',
      'mail',
      `${templateName}.html`
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateName}`);
    }

    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(templateContent);

    // Cache compiled template
    this.templateCache.set(templateName, compiled);

    return compiled;
  }

  /**
   * Send email
   */
  async sendMail(options: MailOptions): Promise<boolean> {
    try {
      if (!transporter) {
        logger.warn('[Mail] Transporter not configured. Email not sent.');
        console.log('[Mail] Would send email:', {
          to: options.to,
          subject: options.subject,
          template: options.template,
        });
        return false;
      }

      // Load and compile template
      const template = await this.loadTemplate(options.template);
      const html = template(options.data);

      // Send email
      const info = await transporter.sendMail({
        from: `${mailConfig.from.name} <${mailConfig.from.email}>`,
        to: options.to,
        subject: options.subject,
        html,
      });

      logger.info('[Mail] Email sent successfully', {
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
      });

      return true;
    } catch (error) {
      logger.error('[Mail] Failed to send email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        to: options.to,
        subject: options.subject,
      });
      return false;
    }
  }

  /**
   * Send order received email
   */
  async sendOrderReceivedEmail(to: string, data: OrderReceivedData): Promise<boolean> {
    return this.sendMail({
      to,
      subject: `Siparişiniz Alındı - #${data.orderNumber}`,
      template: 'order-received',
      data,
    });
  }

  /**
   * Send order shipped email
   */
  async sendOrderShippedEmail(to: string, data: OrderShippedData): Promise<boolean> {
    return this.sendMail({
      to,
      subject: `Siparişiniz Kargoya Verildi - #${data.orderNumber}`,
      template: 'order-shipped',
      data,
    });
  }
}

export const mailService = new MailService();
export type { OrderReceivedData, OrderShippedData };
