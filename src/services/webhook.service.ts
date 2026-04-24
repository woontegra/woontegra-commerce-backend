import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export type WebhookEvent = 
  | 'order.created'
  | 'order.updated'
  | 'order.cancelled'
  | 'order.completed'
  | 'payment.success'
  | 'payment.failed'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'customer.created'
  | 'customer.updated';

export interface WebhookPayload {
  event: WebhookEvent;
  data: any;
  timestamp: string;
  tenantId: string;
}

export interface WebhookConfig {
  id?: string;
  tenantId: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  isActive: boolean;
  headers?: Record<string, string>;
  retryCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export class WebhookService {
  private static MAX_RETRIES = 5;
  private static RETRY_DELAY = 1000; // 1 second

  /**
   * Register a new webhook
   */
  static async registerWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookConfig> {
    try {
      // Validate URL
      if (!this.isValidUrl(config.url)) {
        throw new Error('Invalid webhook URL');
      }

      // Generate secret if not provided
      const secret = config.secret || this.generateSecret();

      const webhook = await prisma.webhook.create({
        data: {
          tenantId: config.tenantId,
          url: config.url,
          events: config.events,
          secret,
          isActive: config.isActive ?? true,
          headers: config.headers || {},
          retryCount: config.retryCount || 3,
        },
      });

      logger.info(`Webhook registered: ${config.url}`, {
        tenantId: config.tenantId,
        events: config.events,
      });

      return this.formatWebhook(webhook);
    } catch (error) {
      logger.error('Webhook registration failed:', error);
      throw error;
    }
  }

  /**
   * Update webhook
   */
  static async updateWebhook(
    webhookId: string,
    updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<WebhookConfig> {
    try {
      if (updates.url && !this.isValidUrl(updates.url)) {
        throw new Error('Invalid webhook URL');
      }

      const webhook = await prisma.webhook.update({
        where: { id: webhookId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
      });

      logger.info(`Webhook updated: ${webhook.url}`, { webhookId });

      return this.formatWebhook(webhook);
    } catch (error) {
      logger.error('Webhook update failed:', error);
      throw error;
    }
  }

  /**
   * Delete webhook
   */
  static async deleteWebhook(webhookId: string): Promise<void> {
    try {
      await prisma.webhook.delete({
        where: { id: webhookId },
      });

      logger.info(`Webhook deleted: ${webhookId}`);
    } catch (error) {
      logger.error('Webhook deletion failed:', error);
      throw error;
    }
  }

  /**
   * Get webhooks for tenant
   */
  static async getWebhooks(tenantId: string, event?: WebhookEvent): Promise<WebhookConfig[]> {
    try {
      const webhooks = await prisma.webhook.findMany({
        where: {
          tenantId,
          isActive: true,
          ...(event && { events: { has: event } }),
        },
        orderBy: { createdAt: 'desc' },
      });

      return webhooks.map((w: any) => this.formatWebhook(w));
    } catch (error) {
      logger.error('Get webhooks failed:', error);
      throw error;
    }
  }

  /**
   * Trigger webhooks for an event
   */
  static async triggerEvent(
    tenantId: string,
    event: WebhookEvent,
    data: any
  ): Promise<Array<{ webhookId: string; success: boolean; error?: string }>> {
    try {
      const webhooks = await this.getWebhooks(tenantId, event);
      
      if (webhooks.length === 0) {
        return [];
      }

      const payload: WebhookPayload = {
        event,
        data,
        timestamp: new Date().toISOString(),
        tenantId,
      };

      const results = await Promise.all(
        webhooks.map(async (webhook) => {
          try {
            await this.sendWebhook(webhook, payload);
            return { webhookId: webhook.id!, success: true };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Log failed delivery
            await this.logDelivery(webhook.id!, payload, false, errorMessage);
            
            return {
              webhookId: webhook.id!,
              success: false,
              error: errorMessage,
            };
          }
        })
      );

      logger.info(`Webhooks triggered for event: ${event}`, {
        tenantId,
        total: webhooks.length,
        successful: results.filter((r) => r.success).length,
      });

      return results;
    } catch (error) {
      logger.error('Trigger webhooks failed:', error);
      throw error;
    }
  }

  /**
   * Send webhook with retry logic
   */
  private static async sendWebhook(
    webhook: WebhookConfig,
    payload: WebhookPayload
  ): Promise<void> {
    const maxRetries = webhook.retryCount || this.MAX_RETRIES;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const signature = this.generateSignature(webhook.secret!, payload);

        const response = await axios.post(webhook.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': payload.event,
            'X-Webhook-Timestamp': payload.timestamp,
            ...webhook.headers,
          },
          timeout: 30000, // 30 seconds
          validateStatus: (status) => status < 500,
        });

        if (response.status >= 200 && response.status < 300) {
          // Log successful delivery
          await this.logDelivery(webhook.id!, payload, true);
          return;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < maxRetries - 1) {
          // Wait before retry
          await this.delay(this.RETRY_DELAY * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  /**
   * Verify webhook signature
   */
  static verifySignature(payload: WebhookPayload, secret: string, signature: string): boolean {
    const expectedSignature = this.generateSignature(secret, payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Generate webhook signature
   */
  private static generateSignature(secret: string, payload: WebhookPayload): string {
    const data = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }

  /**
   * Generate webhook secret
   */
  private static generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate URL
   */
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Delay helper
   */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Log webhook delivery
   */
  private static async logDelivery(
    webhookId: string,
    payload: WebhookPayload,
    success: boolean,
    error?: string
  ): Promise<void> {
    try {
      await prisma.webhookDelivery.create({
        data: {
          webhookId,
          event: payload.event,
          payload: payload,
          success,
          error,
          createdAt: new Date(),
        },
      });
    } catch (logError) {
      logger.error('Failed to log webhook delivery:', logError);
    }
  }

  /**
   * Format webhook for return
   */
  private static formatWebhook(webhook: any): WebhookConfig {
    return {
      id: webhook.id,
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
      secret: webhook.secret,
      isActive: webhook.isActive,
      headers: webhook.headers || {},
      retryCount: webhook.retryCount,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    };
  }

  /**
   * Test webhook
   */
  static async testWebhook(webhookId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const webhook = await prisma.webhook.findUnique({
        where: { id: webhookId },
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      const testPayload: WebhookPayload = {
        event: 'test',
        data: { message: 'This is a test webhook' },
        timestamp: new Date().toISOString(),
        tenantId: webhook.tenantId,
      };

      await this.sendWebhook(this.formatWebhook(webhook), testPayload);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get webhook delivery history
   */
  static async getDeliveryHistory(
    webhookId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Array<{
    id: string;
    event: string;
    success: boolean;
    error?: string;
    createdAt: Date;
  }>> {
    try {
      const { limit = 50, offset = 0 } = options;

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          event: true,
          success: true,
          error: true,
          createdAt: true,
        },
      });

      return deliveries;
    } catch (error) {
      logger.error('Get delivery history failed:', error);
      throw error;
    }
  }
}

export default WebhookService;
