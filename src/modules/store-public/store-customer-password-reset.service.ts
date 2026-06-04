import prisma from '../../config/database';
import { logger } from '../../config/logger';
import { hashPassword } from '../../common/utils/password.util';
import { sendEmailAsync } from '../../queues/email.queue';
import { storefrontUrl } from '../email/templates/store-email.util';
import type { StoreTenantPublic } from './store-tenant.util';
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from './store-customer-reset-token.util';

export const STORE_PASSWORD_RESET_EXPIRY_MINUTES = 60;

export const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  'Eğer bu e-posta ile kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi.';

function buildResetUrl(tenantSlug: string, plainToken: string): string {
  const base = storefrontUrl(tenantSlug, '/store/sifre-sifirla');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(plainToken)}`;
}

export class StoreCustomerPasswordResetService {
  async requestReset(tenant: StoreTenantPublic, emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;

    const customer = await prisma.customer.findUnique({
      where: { email_tenantId: { email, tenantId: tenant.id } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
      },
    });

    if (!customer?.passwordHash) {
      return;
    }

    const plainToken = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(plainToken);
    const expiresAt = new Date(Date.now() + STORE_PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

    await prisma.$transaction(async tx => {
      await tx.customerPasswordResetToken.updateMany({
        where: {
          tenantId:   tenant.id,
          customerId: customer.id,
          usedAt:     null,
          expiresAt:  { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      await tx.customerPasswordResetToken.create({
        data: {
          tenantId:   tenant.id,
          customerId: customer.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || 'Müşteri';

    try {
      await sendEmailAsync({
        to:       customer.email,
        tenantId: tenant.id,
        template: 'STORE_CUSTOMER_PASSWORD_RESET',
        templateData: {
          storeName:  tenant.name,
          logoUrl:    tenant.logoUrl,
          tenantSlug: tenant.slug,
          customerName,
          resetUrl:          buildResetUrl(tenant.slug, plainToken),
          expiresInMinutes:  STORE_PASSWORD_RESET_EXPIRY_MINUTES,
        },
      });
      logger.info({
        message: '[StorePasswordReset] Reset email queued',
        tenantId: tenant.id,
        customerId: customer.id,
      });
    } catch (error) {
      logger.error({
        message: '[StorePasswordReset] Failed to queue reset email',
        tenantId: tenant.id,
        customerId: customer.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async resetPassword(
    tenant: StoreTenantPublic,
    plainToken: string,
    newPassword: string,
  ): Promise<void> {
    const tokenHash = hashPasswordResetToken(plainToken);

    const record = await prisma.customerPasswordResetToken.findFirst({
      where: {
        tokenHash,
        tenantId: tenant.id,
        usedAt:   null,
        expiresAt: { gt: new Date() },
      },
      include: {
        customer: { select: { id: true, tenantId: true } },
      },
    });

    if (!record || record.customer.tenantId !== tenant.id) {
      throw new Error('Geçersiz veya süresi dolmuş şifre sıfırlama bağlantısı.');
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async tx => {
      const locked = await tx.customerPasswordResetToken.findFirst({
        where: {
          id:       record.id,
          tenantId: tenant.id,
          usedAt:   null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!locked) {
        throw new Error('Geçersiz veya süresi dolmuş şifre sıfırlama bağlantısı.');
      }

      await tx.customer.update({
        where: { id: record.customerId },
        data:  { passwordHash },
      });

      await tx.customerPasswordResetToken.update({
        where: { id: record.id },
        data:  { usedAt: new Date() },
      });

      await tx.customerPasswordResetToken.updateMany({
        where: {
          tenantId:   tenant.id,
          customerId: record.customerId,
          usedAt:     null,
          id:         { not: record.id },
        },
        data: { usedAt: new Date() },
      });
    });
  }
}

export const storeCustomerPasswordResetService = new StoreCustomerPasswordResetService();
