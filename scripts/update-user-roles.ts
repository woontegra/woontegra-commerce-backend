import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateUserRoles() {
  try {
    console.log('🔄 Updating user roles...');

    // SUPER_ADMIN → OWNER
    const superAdmins = await prisma.$executeRawUnsafe(`
      UPDATE users 
      SET role = 'OWNER' 
      WHERE role = 'SUPER_ADMIN'
    `);
    console.log(`✅ Updated ${superAdmins} SUPER_ADMIN users to OWNER`);

    // MANAGER → ADMIN
    const managers = await prisma.$executeRawUnsafe(`
      UPDATE users 
      SET role = 'ADMIN' 
      WHERE role = 'MANAGER'
    `);
    console.log(`✅ Updated ${managers} MANAGER users to ADMIN`);

    console.log('✅ User roles updated successfully!');
    console.log('Now you can run: npx prisma db push');
  } catch (error) {
    console.error('❌ Error updating user roles:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateUserRoles();
