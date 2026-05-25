import { emailLayout, frontendUrl } from './layout';
import { passwordResetTemplate, type PasswordResetTemplateData } from './password-reset';
import { subscriptionNotificationTemplate, type SubscriptionNotificationData } from './subscription';
import { errorAlertTemplate, type ErrorAlertTemplateData } from './error-alert';
import {
  storeOrderCreatedTemplate,
  storeOrderStatusChangedTemplate,
  storeReturnRequestCreatedTemplate,
  storeReturnRequestStatusChangedTemplate,
  storeReturnCompletedTemplate,
  storeRefundRecordedTemplate,
  storeOrderPaymentReceivedTemplate,
  storeOrderPaymentFailedTemplate,
  storeOrderBankTransferPendingTemplate,
  storeOrderBankTransferApprovedTemplate,
  storeOrderCashOnDeliveryCreatedTemplate,
  storeOrderStatusUpdatedTemplate,
} from './store-notifications';
import {
  storeCustomerPasswordResetTemplate,
} from './store-customer-password-reset';

export type EmailTemplateId =
  | 'PASSWORD_RESET'
  | 'SUBSCRIPTION_NOTIFICATION'
  | 'ERROR_ALERT'
  | 'ORDER_CREATED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'SUBSCRIPTION_CANCELED'
  | 'TRIAL_ENDING_SOON'
  | 'TRIAL_EXPIRED'
  | 'STOCK_LOW'
  | 'STORE_ORDER_CREATED'
  | 'STORE_ORDER_STATUS_CHANGED'
  | 'STORE_RETURN_REQUEST_CREATED'
  | 'STORE_RETURN_REQUEST_STATUS_CHANGED'
  | 'STORE_RETURN_COMPLETED'
  | 'STORE_REFUND_RECORDED'
  | 'STORE_CUSTOMER_PASSWORD_RESET'
  | 'STORE_ORDER_PAYMENT_RECEIVED'
  | 'STORE_ORDER_PAYMENT_FAILED'
  | 'STORE_ORDER_BANK_TRANSFER_PENDING'
  | 'STORE_ORDER_BANK_TRANSFER_APPROVED'
  | 'STORE_ORDER_CASH_ON_DELIVERY_CREATED';

export type RenderedEmail = { subject: string; html: string };

export const templates = {
  PASSWORD_RESET: (data: PasswordResetTemplateData) => passwordResetTemplate(data),

  SUBSCRIPTION_NOTIFICATION: (data: SubscriptionNotificationData) =>
    subscriptionNotificationTemplate(data),

  ERROR_ALERT: (data: ErrorAlertTemplateData) => errorAlertTemplate(data),

  ORDER_CREATED: (data: {
    customerName: string;
    orderNumber: string;
    totalAmount: number;
    currency: string;
    items: Array<{ name: string; quantity: number; price: number }>;
  }) => ({
    subject: `Siparişiniz alındı — #${data.orderNumber}`,
    html: emailLayout('Sipariş Onayı', `
      <h2>Siparişiniz alındı</h2>
      <p>Merhaba ${data.customerName}, <strong>#${data.orderNumber}</strong> numaralı siparişiniz alındı.</p>
      <div class="card">
        ${data.items.map(i => `
          <div class="card-row">
            <span class="label">${i.name} × ${i.quantity}</span>
            <span class="value">${i.price.toFixed(2)} ${data.currency}</span>
          </div>
        `).join('')}
        <div class="card-row">
          <span class="label"><b>Toplam</b></span>
          <span class="value">${data.totalAmount.toFixed(2)} ${data.currency}</span>
        </div>
      </div>
    `),
  }),

  PAYMENT_SUCCESS: (data: SubscriptionNotificationData) =>
    subscriptionNotificationTemplate({ ...data, status: 'payment_success' }),

  PAYMENT_FAILED: (data: SubscriptionNotificationData) =>
    subscriptionNotificationTemplate({
      tenantName: data.tenantName,
      plan: data.plan,
      amount: data.amount,
      currency: data.currency,
      reason: data.reason,
      status: 'payment_failed',
    }),

  SUBSCRIPTION_ACTIVATED: (data: {
    tenantName: string;
    plan: string;
    billingCycle: string;
    endDate: Date;
  }) =>
    subscriptionNotificationTemplate({
      tenantName: data.tenantName,
      plan: data.plan,
      billingCycle: data.billingCycle,
      endDate: data.endDate,
      status: 'activated',
    }),

  SUBSCRIPTION_CANCELED: (data: {
    tenantName: string;
    plan: string;
    endDate: Date;
  }) =>
    subscriptionNotificationTemplate({
      tenantName: data.tenantName,
      plan: data.plan,
      endDate: data.endDate,
      status: 'canceled',
    }),

  TRIAL_ENDING_SOON: (data: {
    tenantName: string;
    daysLeft: number;
    trialEndsAt: Date;
  }) => ({
    subject: `Deneme süreniz ${data.daysLeft} gün içinde sona eriyor`,
    html: emailLayout('Deneme Süresi', `
      <h2>Deneme süreniz bitiyor</h2>
      <p><strong>${data.tenantName}</strong>, deneme süreniz <strong>${data.daysLeft} gün</strong> içinde sona erecek.</p>
      <a href="${frontendUrl('/plans')}" class="btn">Plan Seç</a>
    `),
  }),

  TRIAL_EXPIRED: (data: { tenantName: string }) => ({
    subject: 'Deneme süreniz sona erdi',
    html: emailLayout('Deneme Süresi Doldu', `
      <h2>Deneme süreniz sona erdi</h2>
      <p><strong>${data.tenantName}</strong>, devam etmek için plan seçin.</p>
      <a href="${frontendUrl('/plans')}" class="btn">Plan Seç</a>
    `),
  }),

  STOCK_LOW: (data: {
    productName: string;
    currentQty: number;
    threshold: number;
  }) => ({
    subject: `Düşük stok: ${data.productName}`,
    html: emailLayout('Stok Uyarısı', `
      <h2>Düşük stok uyarısı</h2>
      <p><strong>${data.productName}</strong> — mevcut: ${data.currentQty}, eşik: ${data.threshold}</p>
      <a href="${frontendUrl('/dashboard/products')}" class="btn">Stoğu Güncelle</a>
    `),
  }),

  STORE_ORDER_CREATED: (data) => storeOrderCreatedTemplate(data as never),
  STORE_ORDER_STATUS_CHANGED: (data) => storeOrderStatusChangedTemplate(data as never),
  STORE_RETURN_REQUEST_CREATED: (data) => storeReturnRequestCreatedTemplate(data as never),
  STORE_RETURN_REQUEST_STATUS_CHANGED: (data) => storeReturnRequestStatusChangedTemplate(data as never),
  STORE_RETURN_COMPLETED: (data) => storeReturnCompletedTemplate(data as never),
  STORE_REFUND_RECORDED: (data) => storeRefundRecordedTemplate(data as never),
  STORE_CUSTOMER_PASSWORD_RESET: (data) => storeCustomerPasswordResetTemplate(data as never),
  STORE_ORDER_PAYMENT_RECEIVED: (data) => storeOrderPaymentReceivedTemplate(data as never),
  STORE_ORDER_PAYMENT_FAILED: (data) => storeOrderPaymentFailedTemplate(data as never),
  STORE_ORDER_BANK_TRANSFER_PENDING: (data) => storeOrderBankTransferPendingTemplate(data as never),
  STORE_ORDER_BANK_TRANSFER_APPROVED: (data) => storeOrderBankTransferApprovedTemplate(data as never),
  STORE_ORDER_CASH_ON_DELIVERY_CREATED: (data) => storeOrderCashOnDeliveryCreatedTemplate(data as never),
  STORE_ORDER_STATUS_UPDATED: (data) => storeOrderStatusUpdatedTemplate(data as never),
};

export type TemplateKey = keyof typeof templates;

export function renderEmailTemplate(
  template: TemplateKey,
  data: Record<string, unknown>,
): RenderedEmail {
  const fn = templates[template] as (d: Record<string, unknown>) => RenderedEmail;
  if (!fn) {
    throw new Error(`Bilinmeyen e-posta şablonu: ${template}`);
  }
  return fn(data);
}
