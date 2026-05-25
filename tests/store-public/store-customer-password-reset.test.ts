import { describe, expect, it } from 'vitest';
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from '../../src/modules/store-public/store-customer-reset-token.util';
import { renderEmailTemplate } from '../../src/modules/email/templates';
import { storefrontUrl } from '../../src/modules/email/templates/store-email.util';
import { FORGOT_PASSWORD_SUCCESS_MESSAGE } from '../../src/modules/store-public/store-customer-password-reset.service';

describe('store customer password reset token', () => {
  it('hashes token consistently and never stores plain text shape in hash', () => {
    const plain = generatePasswordResetToken();
    expect(plain.length).toBeGreaterThanOrEqual(32);
    const hash = hashPasswordResetToken(plain);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashPasswordResetToken(plain));
    expect(hash).not.toBe(plain);
  });

  it('different tokens produce different hashes', () => {
    const a = hashPasswordResetToken(generatePasswordResetToken());
    const b = hashPasswordResetToken(generatePasswordResetToken());
    expect(a).not.toBe(b);
  });
});

describe('STORE_CUSTOMER_PASSWORD_RESET template', () => {
  it('renders Turkish subject and reset link with tenant', () => {
    const resetUrl = `${storefrontUrl('demo', '/store/sifre-sifirla')}&token=abc123`;
    const rendered = renderEmailTemplate('STORE_CUSTOMER_PASSWORD_RESET', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName: 'Ali Veli',
      resetUrl,
      expiresInMinutes: 60,
    });
    expect(rendered.subject).toContain('Şifre');
    expect(rendered.html).toContain('Şifrenizi sıfırlayın');
    expect(rendered.html).toContain('60 dakika');
    expect(rendered.html).toContain('tenant=demo');
    expect(rendered.html).toContain('dikkate almayın');
  });
});

describe('forgot password security message', () => {
  it('uses non-enumerating success message', () => {
    expect(FORGOT_PASSWORD_SUCCESS_MESSAGE).toMatch(/kayıtlı bir hesap varsa/i);
    expect(FORGOT_PASSWORD_SUCCESS_MESSAGE).not.toMatch(/bulunamadı/i);
  });
});
