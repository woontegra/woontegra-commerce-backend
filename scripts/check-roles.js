const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkRoles() {
  try {
    const users = await prisma.$queryRawUnsafe(`
      SELECT email, role FROM users
    `);
    
    console.log('Current users and roles:');
    console.table(users);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkRoles();
