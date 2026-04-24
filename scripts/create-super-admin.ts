// @ts-nocheck
/* eslint-disable */
/**
 * Super Admin oluşturma scripti.
 *
 * Kullanım:
 *   npx ts-node scripts/create-super-admin.ts <email> <şifre> <ad> <soyad>
 *
 * Örnek:
 *   npx ts-node scripts/create-super-admin.ts admin@woontegra.com Gizli123! Ahmet Yılmaz
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const [, , email, password, firstName = 'Super', lastName = 'Admin'] = process.argv;

  if (!email || !password) {
    console.error('\n❌  Kullanım: npx ts-node scripts/create-super-admin.ts <email> <şifre> [ad] [soyad]\n');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌  Şifre en az 8 karakter olmalıdır.');
    process.exit(1);
  }

  // Check duplicate
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.error(`❌  "${email}" adresiyle zaten bir kullanıcı var (role: ${existing.role}).`);
    process.exit(1);
  }

  // Create a dedicated tenant for super admin
  const slug = `superadmin-${Date.now()}`;
  const tenant = await prisma.tenant.create({
    data: { name: 'Super Admin Tenant', slug, subdomain: slug, isActive: true },
  });

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      password:  hashed,
      firstName,
      lastName,
      role:      'SUPER_ADMIN',
      isActive:  true,
      plan:      'ENTERPRISE',
      tenantId:  tenant.id,
    },
  });

  console.log('\n✅  Super Admin başarıyla oluşturuldu!');
  console.log('─────────────────────────────────────');
  console.log(`   ID       : ${user.id}`);
  console.log(`   E-posta  : ${user.email}`);
  console.log(`   Ad Soyad : ${user.firstName} ${user.lastName}`);
  console.log(`   Rol      : ${user.role}`);
  console.log('─────────────────────────────────────');
  console.log('🔗  Giriş adresi: /login  →  /admin\n');
}

main()
  .catch((e) => { console.error('❌  Hata:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
