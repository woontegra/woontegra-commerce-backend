const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateRoles() {
  try {
    console.log('🔄 Step 1: Adding new enum values to UserRole...');
    
    // Add new enum values
    await prisma.$executeRawUnsafe(`
      ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
    `);
    console.log('✅ Added OWNER');
    
    await prisma.$executeRawUnsafe(`
      ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STAFF';
    `);
    console.log('✅ Added STAFF');

    console.log('\n🔄 Step 2: Migrating existing users...');
    
    // SUPER_ADMIN → OWNER
    const superAdmins = await prisma.$executeRawUnsafe(`
      UPDATE users 
      SET role = 'OWNER' 
      WHERE role = 'SUPER_ADMIN'
    `);
    console.log(`✅ Migrated ${superAdmins} SUPER_ADMIN → OWNER`);

    // MANAGER → ADMIN
    const managers = await prisma.$executeRawUnsafe(`
      UPDATE users 
      SET role = 'ADMIN' 
      WHERE role = 'MANAGER'
    `);
    console.log(`✅ Migrated ${managers} MANAGER → ADMIN`);

    console.log('\n✅ Migration completed successfully!');
    console.log('Now you can run: npx prisma db push (answer y)');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

migrateRoles();
