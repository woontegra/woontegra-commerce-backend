/**
 * Reindex ALL products from ALL tenants into Meilisearch.
 * Usage: npx ts-node scripts/reindex-products.ts
 */
import { PrismaClient } from '@prisma/client';
import { Meilisearch } from 'meilisearch';
import { toProductDocument } from '../src/modules/search/search.service';

const prisma  = new PrismaClient();
const client  = new Meilisearch({
  host:   process.env.MEILISEARCH_HOST   || 'http://127.0.0.1:7700',
  apiKey: process.env.MEILISEARCH_API_KEY || 'masterKey',
});

async function main() {
  console.log('🔍 Meilisearch reindex başladı...\n');

  // Ping
  await client.health();
  console.log('✓ Meilisearch bağlantısı tamam\n');

  // Index settings
  const index = client.index('products');
  await client.createIndex('products', { primaryKey: 'id' }).catch(() => {});
  await index.updateSearchableAttributes(['name', 'description', 'sku', 'categoryName']);
  await index.updateFilterableAttributes(['tenantId', 'categoryId', 'categoryName', 'isActive', 'hasVariants', 'unitType', 'price', 'stockTotal']);
  await index.updateSortableAttributes(['price', 'createdAt', 'updatedAt', 'name', 'stockTotal']);
  console.log('✓ Index ayarları güncellendi\n');

  // Fetch all products
  const products = await prisma.product.findMany({
    include: { category: true, variants: true },
  });

  console.log(`📦 ${products.length} ürün bulundu\n`);

  if (!products.length) {
    console.log('İndekslenecek ürün yok.');
    return;
  }

  // Batch upsert
  const BATCH = 500;
  let indexed = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH).map(toProductDocument);
    const task  = await index.addDocuments(batch);
    indexed += batch.length;
    console.log(`  ✓ ${indexed}/${products.length} ürün (task ${task.taskUid})`);
  }

  console.log(`\n✅ Tamamlandı: ${indexed} ürün Meilisearch'e yüklendi.`);
}

main()
  .catch(e => { console.error('❌ Hata:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
