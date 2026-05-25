/**
 * Mevcut kullanıcıyı OWNER (veya isteğe bağlı ADMIN) → SUPER_ADMIN yapar.
 *
 * Kullanım (backend klasöründen):
 *   node scripts/promote-owner-to-super-admin.js <email>
 *
 * Örnek:
 *   node scripts/promote-owner-to-super-admin.js sizin@email.com
 *
 * Not: Çıktıdan sonra tekrar giriş yapın (JWT içinde eski rol kalabilir).
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || process.env.PROMOTE_SUPER_ADMIN_EMAIL || '').trim();
  if (!email) {
    console.error('\n❌  E-posta gerekli.\n');
    console.error('   node scripts/promote-owner-to-super-admin.js <email>\n');
    console.error('   veya: PROMOTE_SUPER_ADMIN_EMAIL=... node scripts/promote-owner-to-super-admin.js\n');
    process.exit(1);
  }

  const alsoAdmin = process.argv.includes('--include-admin');

  const where = {
    email: { equals: email, mode: 'insensitive' },
    role: alsoAdmin ? { in: ['OWNER', 'ADMIN'] } : 'OWNER',
  };

  const before = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, role: true, tenantId: true },
  });

  if (before.length === 0) {
    console.error(`\n❌  Bu e-posta ile kullanıcı bulunamadı: ${email}\n`);
    process.exit(1);
  }

  const result = await prisma.user.updateMany({
    where,
    data: { role: 'SUPER_ADMIN' },
  });

  if (result.count === 0) {
    console.error('\n❌  Güncellenen satır yok. Mevcut kayıtlar:');
    for (const u of before) {
      console.error(`   - ${u.email}  role=${u.role}  tenantId=${u.tenantId}`);
    }
    console.error(
      '\n   Rolünüz OWNER değilse: node scripts/promote-owner-to-super-admin.js <email> --include-admin\n',
    );
    process.exit(1);
  }

  const after = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, role: true },
  });

  console.log(`\n✅  ${result.count} kullanıcı SUPER_ADMIN yapıldı.\n`);
  for (const u of after) {
    console.log(`   ${u.email}  →  ${u.role}`);
  }
  console.log('\n🔗  Çıkış yapıp tekrar giriş yapın; ardından /admin açılmalı.\n');
}

main()
  .catch((e) => {
    console.error('❌  Hata:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
