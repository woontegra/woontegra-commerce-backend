import { describe, expect, it } from 'vitest';
import {
  normalizeShippingInput,
  sanitizeShippingTrackingUrl,
} from '../../src/modules/orders/order-shipping.util';

describe('order-shipping.util', () => {
  it('accepts https tracking url', () => {
    expect(sanitizeShippingTrackingUrl('https://kargo.test/t/1')).toBe('https://kargo.test/t/1');
  });

  it('rejects invalid tracking url scheme', () => {
    expect(() => sanitizeShippingTrackingUrl('ftp://bad.url')).toThrow(/https/i);
  });

  it('normalizes empty strings to null', () => {
    expect(
      normalizeShippingInput({
        shippingCarrier: 'MNG',
        shippingTrackingNumber: '  ',
        shippingTrackingUrl: '',
      }),
    ).toEqual({
      shippingCarrier:        'MNG',
      shippingTrackingNumber: null,
      shippingTrackingUrl:    null,
    });
  });
});
