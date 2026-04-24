const { PrismaClient } = require('../node_modules/@prisma/client');
const p = new PrismaClient({ log: ['error', 'warn'] });

async function run() {
  try {
    const slug = 'test-cat-' + Date.now();
    const result = await p.category.create({
      data: {
        name: 'Test Kategori',
        slug,
        level: 0,
        path: slug,
        order: 0,
        isActive: true,
        tenantId: 'non-existent'
      }
    });
    console.log('OK:', result.id);
  } catch(e) {
    console.log('ERROR CODE:', e.code);
    console.log('ERROR MSG:', e.message.substring(0, 500));
  } finally {
    await p.$disconnect();
  }
}
run();
