import { describe, expect, it } from 'vitest';
import { shouldSendPaytrPaymentFailedNotification } from '../../src/modules/email/templates/store-email.util';

/**
 * PayTR handleCallback failed dalındaki mail idempotency kuralları (saf fonksiyon).
 * Tam callback entegrasyonu Redis/DB mock gerektirdiği için util seviyesinde doğrulanır.
 */
describe('PayTR failed callback email idempotency rules', () => {
  it('first failed: INITIATED + PENDING → send payment failed email', () => {
    expect(shouldSendPaytrPaymentFailedNotification('INITIATED', 'PENDING')).toBe(true);
  });

  it('second failed: FAILED + CANCELLED → no email', () => {
    expect(shouldSendPaytrPaymentFailedNotification('FAILED', 'CANCELLED')).toBe(false);
    expect(
      shouldSendPaytrPaymentFailedNotification('INITIATED', 'PENDING', {
        paymentFailedEmailSentAt: new Date(),
      }),
    ).toBe(false);
  });

  it('paid order: never send payment failed email', () => {
    expect(shouldSendPaytrPaymentFailedNotification('INITIATED', 'PAID')).toBe(false);
    expect(shouldSendPaytrPaymentFailedNotification('FAILED', 'PAID')).toBe(false);
  });
});
