import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildPaytrIframeToken, verifyPaytrCallbackHash } from '../../src/modules/store-public/paytr/store-paytr.crypto';

describe('store-paytr.crypto', () => {
  const merchantKey  = 'test_key';
  const merchantSalt = 'test_salt';
  const merchantId   = '123456';

  it('buildPaytrIframeToken produces stable base64', () => {
    const token = buildPaytrIframeToken({
      merchantId,
      merchantKey,
      merchantSalt,
      userIp:         '127.0.0.1',
      merchantOid:    'abc123',
      email:          'a@b.com',
      paymentAmount:  '10000',
      userBasket:     'W10=',
      noInstallment:  '0',
      maxInstallment: '0',
      currency:       'TL',
      testMode:       '1',
    });
    expect(token).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(token.length).toBeGreaterThan(10);
  });

  it('verifyPaytrCallbackHash accepts matching hash', () => {
    const merchantOid = 'oid1';
    const status = 'success';
    const totalAmount = '5000';
    const paytrToken = merchantOid + merchantSalt + status + totalAmount;
    const hash = crypto.createHmac('sha256', merchantKey).update(paytrToken).digest('base64');

    expect(
      verifyPaytrCallbackHash({
        merchantKey,
        merchantSalt,
        merchantOid,
        status,
        totalAmount,
        hash,
      }),
    ).toBe(true);
  });

  it('verifyPaytrCallbackHash rejects wrong hash', () => {
    expect(
      verifyPaytrCallbackHash({
        merchantKey,
        merchantSalt,
        merchantOid: 'x',
        status:      'failed',
        totalAmount: '100',
        hash:        'invalid',
      }),
    ).toBe(false);
  });
});
