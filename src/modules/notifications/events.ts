import EventEmitter from 'events';

// ─── Event Payloads ───────────────────────────────────────────────────────────

export interface OrderCreatedPayload {
  tenantId:      string;
  orderId:       string;
  orderNumber:   string;
  totalAmount:   number;
  currency:      string;
  customerEmail: string;
  customerName:  string;
  items:         Array<{ name: string; quantity: number; price: number }>;
}

export interface OrderStatusChangedPayload {
  tenantId:     string;
  orderId:      string;
  orderNumber:  string;
  oldStatus:    string;
  newStatus:    string;
  customerEmail: string;
  customerName: string;
}

export interface PaymentSuccessPayload {
  tenantId:       string;
  tenantName:     string;
  plan:           string;
  billingCycle:   string;
  amount:         number;
  currency:       string;
  invoiceNumber?: string;
  adminEmail:     string;
}

export interface PaymentFailedPayload {
  tenantId:     string;
  tenantName:   string;
  plan:         string;
  amount:       number;
  currency:     string;
  reason:       string;
  adminEmail:   string;
}

export interface SubscriptionActivatedPayload {
  tenantId:     string;
  tenantName:   string;
  plan:         string;
  billingCycle: string;
  endDate:      Date;
  adminEmail:   string;
}

export interface SubscriptionCanceledPayload {
  tenantId:     string;
  tenantName:   string;
  plan:         string;
  endDate:      Date;
  adminEmail:   string;
}

export interface TrialEndingSoonPayload {
  tenantId:     string;
  tenantName:   string;
  daysLeft:     number;
  trialEndsAt:  Date;
  adminEmail:   string;
}

export interface TrialExpiredPayload {
  tenantId:    string;
  tenantName:  string;
  adminEmail:  string;
}

export interface StockLowPayload {
  tenantId:    string;
  productId:   string;
  productName: string;
  currentQty:  number;
  threshold:   number;
}

export interface UserBannedPayload {
  tenantId:  string;
  userId:    string;
  userEmail: string;
  reason?:   string;
}

export interface TenantSuspendedPayload {
  tenantId:   string;
  tenantName: string;
  reason?:    string;
  adminEmail: string;
}

// ─── Event Map ────────────────────────────────────────────────────────────────

export interface AppEventMap {
  ORDER_CREATED:            OrderCreatedPayload;
  ORDER_STATUS_CHANGED:     OrderStatusChangedPayload;
  PAYMENT_SUCCESS:          PaymentSuccessPayload;
  PAYMENT_FAILED:           PaymentFailedPayload;
  SUBSCRIPTION_ACTIVATED:   SubscriptionActivatedPayload;
  SUBSCRIPTION_CANCELED:    SubscriptionCanceledPayload;
  TRIAL_ENDING_SOON:        TrialEndingSoonPayload;
  TRIAL_EXPIRED:            TrialExpiredPayload;
  STOCK_LOW:                StockLowPayload;
  USER_BANNED:              UserBannedPayload;
  TENANT_SUSPENDED:         TenantSuspendedPayload;
}

export type AppEventName = keyof AppEventMap;

// ─── Typed Event Bus ──────────────────────────────────────────────────────────

class AppEventBus extends EventEmitter {
  emit<K extends AppEventName>(event: K, payload: AppEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends AppEventName>(event: K, listener: (payload: AppEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  once<K extends AppEventName>(event: K, listener: (payload: AppEventMap[K]) => void): this {
    return super.once(event, listener);
  }

  off<K extends AppEventName>(event: K, listener: (payload: AppEventMap[K]) => void): this {
    return super.off(event, listener);
  }
}

// Singleton — import this everywhere
export const eventBus = new AppEventBus();
eventBus.setMaxListeners(50);
