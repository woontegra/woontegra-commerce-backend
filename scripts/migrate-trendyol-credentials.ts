// @ts-nocheck
/**
 * Mevcut düz metin Trendyol credential kayıtlarını şifreler.
 *
 * Kullanım (backend klasöründen):
 *   npx ts-node scripts/migrate-trendyol-credentials.ts
 *   npx ts-node scripts/migrate-trendyol-credentials.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';
import {
  assertMarketplaceEncryptionKeyConfigured,
  encryptCredential,
  isCredentialEncrypted,
} from '../src/common/crypto/marketplace-credential.crypto';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  assertMarketplaceEncryptionKeyConfigured();

  const rows = await prisma.trendyolIntegration.findMany({
    select: { id: true, tenantId: true, apiKey: true, apiSecret: true, token: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const data: { apiKey?: string; apiSecret?: string; token?: string | null } = {};

    if (row.apiKey && !isCredentialEncrypted(row.apiKey)) {
      data.apiKey = encryptCredential(row.apiKey);
    }
    if (row.apiSecret && !isCredentialEncrypted(row.apiSecret)) {
      data.apiSecret = encryptCredential(row.apiSecret);
    }
    if (row.token && !isCredentialEncrypted(row.token)) {
      data.token = encryptCredential(row.token);
    }

    if (Object.keys(data).length === 0) {
      skipped++;
      continue;
    }

    console.log(
      `[${dryRun ? 'DRY' : 'OK'}] tenant=${row.tenantId} id=${row.id} fields=${Object.keys(data).join(',')}`,
    );

    if (!dryRun) {
      await prisma.trendyolIntegration.update({
        where: { id: row.id },
        data,
      });
    }
    updated++;
  }

  console.log(`\nToplam: ${rows.length}, şifrelenecek: ${updated}, zaten şifreli/boş: ${skipped}`);
  if (dryRun && updated > 0) {
    console.log('Uygulamak için --dry-run olmadan tekrar çalıştırın.');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
