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

export class WebhookService {
  /**
   * Generate a webhook secret
   */
  static generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Sign webhook payload with HMAC-SHA256
   */
  private static signPayload(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Create a new webhook
   */
  static async createWebhook(data: {
    tenantId: string;
    url: string;
    events: WebhookEvent[];
    description?: string;
  }): Promise<any> {
    try {
      const secret = this.generateSecret();

      const webhook = await prisma.webhook.create({
        data: {
          tenantId: data.tenantId,
          url: data.url,
          secret,
          events: data.events,
          description: data.description,
        },
      });

      logger.info('[WebhookService] Webhook created', { 
        id: webhook.id, 
        tenantId: data.tenantId,
        events: data.events,
      });

      return webhook;
    } catch (error) {
      logger.error('[WebhookService] Error creating webhook', { error });
      throw error;
    }
  }

  /**
   * Get all webhooks for a tenant
   */
  static async getWebhooks(tenantId: string): Promise<any[]> {
    try {
      return await prisma.webhook.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      logger.error('[WebhookService] Error getting webhooks', { error });
      throw error;
    }
  }

  /**
   * Update a webhook
   */
  static async updateWebhook(
    id: string,
    tenantId: string,
    data: {
      url?: string;
      events?: WebhookEvent[];
      description?: string;
      isActive?: boolean;
    }
  ): Promise<any> {
    try {
      return await prisma.webhook.update({
        where: { id, tenantId },
        data,
      });
    } catch (error) {
      logger.error('[WebhookService] Error updating webhook', { error });
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  static async deleteWebhook(id: string, tenantId: string): Promise<void> {
    try {
      await prisma.webhook.delete({
        where: { id, tenantId },
      });

      logger.info('[WebhookService] Webhook deleted', { id, tenantId });
    } catch (error) {
      logger.error('[WebhookService] Error deleting webhook', { error });
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
  ): Promise<void> {
    try {
      // Get all active webhooks for this event
      const webhooks = await prisma.webhook.findMany({
        where: {
          tenantId,
          isActive: true,
          events: {
            has: event,
          },
        },
      });

      if (webhooks.length === 0) {
        logger.debug('[WebhookService] No webhooks found for event', { event, tenantId });
        return;
      }

      logger.info('[WebhookService] Triggering webhooks', { 
        event, 
        tenantId,
        count: webhooks.length,
      });

      // Trigger all webhooks in parallel
      const promises = webhooks.map(webhook => 
        this.deliverWebhook(webhook, event, data)
      );

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error('[WebhookService] Error triggering event', { error, event });
    }
  }

  /**
   * Deliver a webhook
   */
  private static async deliverWebhook(
    webhook: any,
    event: WebhookEvent,
    data: any,
    attempt: number = 1
  ): Promise<void> {
    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
      tenantId: webhook.tenantId,
    };

    const payloadString = JSON.stringify(payload);
    const signature = this.signPayload(payloadString, webhook.secret);

    try {
      logger.info('[WebhookService] Delivering webhook', {
        webhookId: webhook.id,
        event,
        url: webhook.url,
        attempt,
      });

      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
          'User-Agent': 'Woontegra-Webhook/1.0',
        },
        timeout: 10000, // 10 seconds
      });

      // Log success
      await prisma.webhookLog.create({
        data: {
          webhookId: webhook.id,
          event,
          payload,
          statusCode: response.status,
          response: response.data ? JSON.stringify(response.data).substring(0, 1000) : null,
          success: true,
          attempts: attempt,
        },
      });

      logger.info('[WebhookService] Webhook delivered successfully', {
        webhookId: webhook.id,
        event,
        statusCode: response.status,
      });
    } catch (error: any) {
      const statusCode = error.response?.status;
      const responseData = error.response?.data;

      logger.error('[WebhookService] Webhook delivery failed', {
        webhookId: webhook.id,
        event,
        attempt,
        statusCode,
        error: error.message,
      });

      // Calculate next retry time (exponential backoff)
      const nextRetryAt = attempt < 3 
        ? new Date(Date.now() + Math.pow(2, attempt) * 60000) // 2^n minutes
        : null;

      // Log failure
      await prisma.webhookLog.create({
        data: {
          webhookId: webhook.id,
          event,
          payload,
          statusCode,
          response: responseData ? JSON.stringify(responseData).substring(0, 1000) : error.message,
          success: false,
          attempts: attempt,
          nextRetryAt,
        },
      });

      // Retry if attempts < 3
      if (attempt < 3) {
        logger.info('[WebhookService] Scheduling retry', {
          webhookId: webhook.id,
          attempt: attempt + 1,
          nextRetryAt,
        });

        // Schedule retry (in production, use a queue system like Bull)
        setTimeout(() => {
          this.deliverWebhook(webhook, event, data, attempt + 1);
        }, Math.pow(2, attempt) * 60000);
      }
    }
  }

  /**
   * Get webhook logs
   */
  static async getWebhookLogs(
    webhookId: string,
    limit: number = 50
  ): Promise<any[]> {
    try {
      return await prisma.webhookLog.findMany({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('[WebhookService] Error getting webhook logs', { error });
      throw error;
    }
  }

  /**
   * Retry failed webhook
   */
  static async retryWebhook(logId: string): Promise<void> {
    try {
      const log = await prisma.webhookLog.findUnique({
        where: { id: logId },
        include: { webhook: true },
      });

      if (!log) {
        throw new Error('Webhook log not found');
      }

      if (log.success) {
        throw new Error('Cannot retry successful webhook');
      }

      await this.deliverWebhook(
        log.webhook,
        log.event as WebhookEvent,
        log.payload,
        log.attempts + 1
      );
    } catch (error) {
      logger.error('[WebhookService] Error retrying webhook', { error });
      throw error;
    }
  }

  /**
   * Test webhook
   */
  static async testWebhook(id: string, tenantId: string): Promise<void> {
    try {
      const webhook = await prisma.webhook.findUnique({
        where: { id, tenantId },
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      await this.deliverWebhook(
        webhook,
        'order.created',
        {
          id: 'test-order-id',
          orderNumber: 'TEST-001',
          total: 100,
          status: 'pending',
          test: true,
        }
      );
    } catch (error) {
      logger.error('[WebhookService] Error testing webhook', { error });
      throw error;
    }
  }
}

export const webhookService = WebhookService;
