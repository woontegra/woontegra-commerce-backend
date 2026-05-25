import { PaymentStatus, SubscriptionStatus } from '@prisma/client';

/** iyzico callback / ödeme kaydı başarılı mı */
export function isPaymentSuccessful(status: PaymentStatus | string | null | undefined): boolean {
  return status === PaymentStatus.SUCCESS || status === 'SUCCESS';
}

/** Başarılı ödeme sonrası abonelik durumu */
export function subscriptionStatusAfterSuccessfulPayment(
  _previous: SubscriptionStatus,
): SubscriptionStatus {
  return SubscriptionStatus.ACTIVE;
}

/** Başarılı ödeme sonrası tenant lifecycle durumu */
export function tenantStatusAfterSuccessfulPayment(): 'ACTIVE' {
  return 'ACTIVE';
}

export interface SubscriptionActivationPatch {
  subscriptionStatus: SubscriptionStatus;
  tenantStatus: 'ACTIVE';
  clearSuspendedAt: true;
}

export function buildSubscriptionActivationPatch(): SubscriptionActivationPatch {
  return {
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    tenantStatus:       'ACTIVE',
    clearSuspendedAt:   true,
  };
}

/** Başarısız ödeme → abonelik iptal (mevcut billing.service davranışı) */
export function subscriptionStatusAfterFailedPayment(): SubscriptionStatus {
  return SubscriptionStatus.CANCELED;
}
