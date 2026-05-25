import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Plan } from '@prisma/client';
import { buildIntegrationApp } from './helpers/app';
import { shouldRunIntegrationTests, resetIntegrationDb } from './helpers/db';
import { seedManyProducts, seedTenantWithUser } from './helpers/seed';

const run = shouldRunIntegrationTests() ? describe : describe.skip;

run('Integration: Plan limit flow', () => {
  const app = buildIntegrationApp();

  beforeEach(async () => {
    await resetIntegrationDb();
  });

  it('STARTER planda 51. ürün POST → 403 PLAN_LIMIT_REACHED', async () => {
    const { token, tenantId } = await seedTenantWithUser({ plan: Plan.STARTER });

    await seedManyProducts(tenantId, 50);

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    '51. ürün',
        price:   10,
        sku:     'LIMIT-51',
        pricing: { salePrice: 10, vatRate: 20 },
        stock:   1,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });
});
