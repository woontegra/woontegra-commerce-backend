import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { BillingService } from '../../src/modules/billing/billing.service';
import { shouldRunIntegrationTests, integrationPrisma, resetIntegrationDb } from './helpers/db';
import { seedPendingBilling, seedTenantWithUser } from './helpers/seed';

const run = shouldRunIntegrationTests() ? describe : describe.skip;

run('Integration: Billing flow', () => {
  const billing = new BillingService();

  beforeEach(async () => {
    await resetIntegrationDb();
  });

  it('ödeme SUCCESS → subscription ACTIVE + tenant ACTIVE', async () => {
    const { tenantId, userId } = await seedTenantWithUser({ tenantStatus: 'PAST_DUE' });
    const { payment, transactionId } = await seedPendingBilling(tenantId, userId);

    await billing.handleWebhook(
      JSON.stringify({ iyzicoPaymentId: transactionId, status: 'SUCCESS' }),
      undefined,
    );

    const updatedPayment = await integrationPrisma.payment.findUnique({
      where: { id: payment.id },
    });
    const updatedSub = await integrationPrisma.subscription.findUnique({
      where: { id: payment.subscriptionId },
    });
    const updatedTenant = await integrationPrisma.tenant.findUnique({
      where: { id: tenantId },
    });

    expect(updatedPayment?.status).toBe(PaymentStatus.SUCCESS);
    expect(updatedSub?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(updatedTenant?.status).toBe('ACTIVE');
    expect(updatedTenant?.suspendedAt).toBeNull();
  });
});
