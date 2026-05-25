import { describe, expect, it } from 'vitest';
import {
  initialOrderPaymentStatus,
  parseOrderPaymentProviderFromNotes,
  resolveOrderPaymentProvider,
} from '../../src/modules/orders/order-payment.util';
import {
  shouldSendBankTransferPaymentApproved,
  shouldSendPaytrPaymentFailedNotification,
  shouldSendPaytrPaymentReceivedNotification,
} from '../../src/modules/email/templates/store-email.util';

describe('resolveOrderPaymentProvider', () => {
  it('prefers persisted paymentProvider over notes', () => {
    expect(
      resolveOrderPaymentProvider({
        paymentProvider: 'BANK_TRANSFER',
        notes:           '[Ödeme yöntemi: PAYTR]',
      }),
    ).toBe('BANK_TRANSFER');
  });

  it('falls back to notes for legacy orders', () => {
    expect(
      resolveOrderPaymentProvider({
        paymentProvider: null,
        notes:           '[Ödeme yöntemi: CASH_ON_DELIVERY]',
      }),
    ).toBe('CASH_ON_DELIVERY');
  });
});

describe('initialOrderPaymentStatus', () => {
  it('sets WAITING_BANK_TRANSFER for bank transfer', () => {
    expect(initialOrderPaymentStatus('BANK_TRANSFER')).toBe('WAITING_BANK_TRANSFER');
    expect(initialOrderPaymentStatus('PAYTR')).toBe('PENDING');
  });
});

describe('payment email idempotency helpers', () => {
  it('blocks repeat bank transfer approval when timestamp set', () => {
    expect(
      shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PROCESSING', {
        bankTransferApprovedEmailSentAt: new Date(),
      }),
    ).toBe(false);
  });

  it('blocks repeat PayTR mails when sent timestamps set', () => {
    expect(shouldSendPaytrPaymentReceivedNotification({ paymentReceivedEmailSentAt: new Date() })).toBe(false);
    expect(
      shouldSendPaytrPaymentFailedNotification('INITIATED', 'PENDING', {
        paymentFailedEmailSentAt: new Date(),
      }),
    ).toBe(false);
  });
});

describe('parseOrderPaymentProviderFromNotes', () => {
  it('parses legacy note format', () => {
    expect(parseOrderPaymentProviderFromNotes('[Ödeme yöntemi: BANK_TRANSFER]')).toBe('BANK_TRANSFER');
  });
});
