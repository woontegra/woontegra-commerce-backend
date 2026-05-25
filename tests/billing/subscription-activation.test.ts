import { describe, it, expect } from 'vitest';
import { PaymentStatus, SubscriptionStatus } from '@prisma/client';
import {
  isPaymentSuccessful,
  subscriptionStatusAfterSuccessfulPayment,
  buildSubscriptionActivationPatch,
  subscriptionStatusAfterFailedPayment,
  tenantStatusAfterSuccessfulPayment,
} from '../../src/modules/billing/billing-activation.util';

describe('billing subscription activation', () => {
  it('SUCCESS ödeme tanınır', () => {
    expect(isPaymentSuccessful(PaymentStatus.SUCCESS)).toBe(true);
    expect(isPaymentSuccessful('SUCCESS')).toBe(true);
    expect(isPaymentSuccessful(PaymentStatus.FAILED)).toBe(false);
  });

  it('başarılı ödeme → abonelik ACTIVE', () => {
    expect(subscriptionStatusAfterSuccessfulPayment(SubscriptionStatus.PENDING)).toBe(
      SubscriptionStatus.ACTIVE,
    );
  });

  it('başarılı ödeme → tenant ACTIVE patch', () => {
    const patch = buildSubscriptionActivationPatch();
    expect(patch.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(patch.tenantStatus).toBe('ACTIVE');
    expect(patch.clearSuspendedAt).toBe(true);
    expect(tenantStatusAfterSuccessfulPayment()).toBe('ACTIVE');
  });

  it('başarısız ödeme → abonelik CANCELED', () => {
    expect(subscriptionStatusAfterFailedPayment()).toBe(SubscriptionStatus.CANCELED);
  });
});
