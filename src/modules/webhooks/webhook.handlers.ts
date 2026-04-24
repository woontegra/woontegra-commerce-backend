/**
 * Registers eventBus → webhook dispatch bridges.
 * Import this file once in main.ts (side effects only).
 */
import { eventBus } from '../notifications/events';
import { dispatchWebhook } from './webhook.service';
import { logger } from '../../utils/logger';

function safe(fn: () => Promise<void>) {
  fn().catch((err) => logger.error({ message: '[Webhook] Handler error', err }));
}

// ─── Order events ─────────────────────────────────────────────────────────────

eventBus.on('ORDER_CREATED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'order.created', p as any));
});

eventBus.on('ORDER_STATUS_CHANGED', (p) => {
  safe(() => dispatchWebhook((p as any).tenantId, 'order.updated', p as any));
});

// ─── Payment events ───────────────────────────────────────────────────────────

eventBus.on('PAYMENT_SUCCESS', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'payment.success', p as any));
});

eventBus.on('PAYMENT_FAILED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'payment.failed', p as any));
});

// ─── Subscription events ──────────────────────────────────────────────────────

eventBus.on('SUBSCRIPTION_ACTIVATED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'subscription.activated', p as any));
});

eventBus.on('SUBSCRIPTION_CANCELED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'subscription.canceled', p as any));
});

// ─── Trial events ─────────────────────────────────────────────────────────────

eventBus.on('TRIAL_ENDING_SOON', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'trial.ending_soon', p as any));
});

eventBus.on('TRIAL_EXPIRED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'trial.expired', p as any));
});

// ─── Tenant events ────────────────────────────────────────────────────────────

eventBus.on('TENANT_SUSPENDED', (p) => {
  safe(() => dispatchWebhook(p.tenantId, 'tenant.suspended', p as any));
});
