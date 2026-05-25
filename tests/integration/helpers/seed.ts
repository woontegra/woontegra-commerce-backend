import {
  BillingCycle,
  PaymentStatus,
  Plan,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateToken } from '../../../src/common/utils/jwt.util';
import { getIntegrationPrisma } from './db';

const integrationPrisma = getIntegrationPrisma();

export interface SeededTenantContext {
  tenantId: string;
  userId:   string;
  email:    string;
  token:    string;
  slug:     string;
}

export async function seedTenantWithUser(opts?: {
  plan?: Plan;
  tenantStatus?: string;
  slug?: string;
}): Promise<SeededTenantContext> {
  const slug = opts?.slug ?? `test-${Date.now()}`;
  const email = `owner-${slug}@integration.test`;

  const tenant = await integrationPrisma.tenant.create({
    data: {
      name:     `Test ${slug}`,
      slug,
      isActive: true,
      status:   (opts?.tenantStatus as any) ?? 'ACTIVE',
    },
  });

  const user = await integrationPrisma.user.create({
    data: {
      email,
      password:  await bcrypt.hash('test-password', 8),
      firstName: 'Test',
      lastName:  'Owner',
      role:      UserRole.OWNER,
      tenantId:  tenant.id,
      plan:      opts?.plan ?? Plan.STARTER,
      isActive:  true,
    },
  });

  if (opts?.plan) {
    await integrationPrisma.subscription.create({
      data: {
        tenantId:     tenant.id,
        userId:       user.id,
        plan:         opts.plan,
        status:       SubscriptionStatus.ACTIVE,
        billingCycle: BillingCycle.MONTHLY,
        startDate: new Date(),
        endDate:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const token = generateToken({
    userId:   user.id,
    tenantId: tenant.id,
    email:    user.email,
    role:     user.role,
  });

  return { tenantId: tenant.id, userId: user.id, email, token, slug };
}

export async function seedManyProducts(tenantId: string, count: number): Promise<void> {
  const base = Date.now();
  await integrationPrisma.product.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      name:     `Bulk ${i}`,
      slug:     `bulk-${base}-${i}`,
      price:    10,
      sku:      `BULK-${base}-${i}`,
      barcode:  `869${String(base + i).slice(-9).padStart(9, '0')}`,
      tenantId,
    })),
  });
}

export async function seedProduct(
  tenantId: string,
  index: number,
  opts?: { sku?: string; salePrice?: number },
) {
  const sku = opts?.sku ?? `SKU-${index}-${Date.now()}`;
  const salePrice = opts?.salePrice ?? 100;

  return integrationPrisma.product.create({
    data: {
      name:     `Product ${index}`,
      slug:     `product-${index}-${Date.now()}`,
      price:    salePrice,
      sku,
      barcode:  `8690000000${String(index).padStart(4, '0')}`,
      tenantId,
      pricing: {
        create: {
          salePrice,
          vatRate: 20,
          currency: 'TRY',
        },
      },
      stock: {
        create: { quantity: 10, tenantId },
      },
    },
    include: { pricing: true },
  });
}

export async function seedPendingBilling(tenantId: string, userId: string) {
  const subscription = await integrationPrisma.subscription.create({
    data: {
      tenantId,
      userId,
      plan:         Plan.PRO,
      status:       SubscriptionStatus.PENDING,
      billingCycle: BillingCycle.MONTHLY,
      startDate: new Date(),
      endDate:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const txId = `iyzico-test-${Date.now()}`;
  const payment = await integrationPrisma.payment.create({
    data: {
      tenantId,
      userId,
      subscriptionId: subscription.id,
      amount:         599,
      currency:       'TRY',
      status:         PaymentStatus.PENDING,
      transactionId:  txId,
      metadata:       { plan: 'PRO' },
    },
  });

  return { subscription, payment, transactionId: txId };
}
