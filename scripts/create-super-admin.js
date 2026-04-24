const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createSuperAdmin() {
  try {
    // Create Woontegra tenant
    const tenant = await prisma.tenant.upsert({
      where: { slug: 'woontegra' },
      update: {},
      create: {
        name: 'Woontegra',
        slug: 'woontegra',
        subdomain: 'woontegra',
        isActive: true,
      },
    });

    console.log('✅ Tenant created:', tenant.slug);

    // Hash password
    const hashedPassword = await bcrypt.hash('EGic28R5DE@?', 10);

    // Create super admin user
    const user = await prisma.user.upsert({
      where: {
        email_tenantId: {
          email: 'info@woontegra.com',
          tenantId: tenant.id,
        },
      },
      update: {
        password: hashedPassword,
        role: 'ADMIN',
        plan: 'ENTERPRISE',
        isActive: true,
      },
      create: {
        email: 'info@woontegra.com',
        password: hashedPassword,
        firstName: 'Woontegra',
        lastName: 'Admin',
        role: 'ADMIN',
        plan: 'ENTERPRISE',
        isActive: true,
        tenantId: tenant.id,
      },
    });

    console.log('\n✅ Super Admin created successfully!');
    console.log('\n📧 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Email:    info@woontegra.com');
    console.log('Password: EGic28R5DE@?');
    console.log('Role:     ADMIN');
    console.log('Plan:     ENTERPRISE (Unlimited)');
    console.log('Tenant:   woontegra');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error creating super admin:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin();
