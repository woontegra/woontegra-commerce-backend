import { describe, it, expect, beforeEach } from 'vitest';
import { Plan } from '@prisma/client';
import { runXmlUrlImportPipeline } from '../../src/modules/products/xml-import.controller';
import { shouldRunIntegrationTests, integrationPrisma, resetIntegrationDb } from './helpers/db';
import { seedTenantWithUser } from './helpers/seed';

const run = shouldRunIntegrationTests() ? describe : describe.skip;

const MAPPING = {
  name:  'name',
  sku:   'sku',
  price: 'price',
  stock: 'stock',
};

function buildDuplicateSkuXml(): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <product>
    <name>İlk</name>
    <sku>SHARED-SKU</sku>
    <price>100</price>
    <stock>5</stock>
  </product>
  <product>
    <name>İkinci Satır</name>
    <sku>SHARED-SKU</sku>
    <price>150</price>
    <stock>8</stock>
  </product>
</catalog>`;
  return Buffer.from(xml, 'utf-8');
}

run('Integration: XML import flow', () => {
  beforeEach(async () => {
    await resetIntegrationDb();
  });

  it('aynı SKU ile ikinci satır create değil update yapar', async () => {
    const { tenantId, userId } = await seedTenantWithUser({ plan: Plan.PRO });
    const buffer = buildDuplicateSkuXml();

    const result = await runXmlUrlImportPipeline({
      tenantId,
      userId,
      buffer,
      mapping:       MAPPING,
      duplicateMode: 'update',
      skipZeroStock: false,
      startedAt:     new Date(),
      logFilename:   'integration-test.xml',
    });

    expect(result.summary.imported).toBe(1);
    expect(result.summary.updated).toBe(1);
    expect(result.summary.failed).toBe(0);

    const products = await integrationPrisma.product.findMany({
      where: { tenantId, sku: 'SHARED-SKU' },
      include: { pricing: true },
    });

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('İkinci Satır');
    expect(Number(products[0].pricing?.salePrice)).toBe(150);
  });
});
