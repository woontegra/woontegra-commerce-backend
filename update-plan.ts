import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.update({
    where: { email: 'info@woontegra.com' },
    data: { plan: 'PRO' },
  });
  console.log('Updated user:', user.email, 'Plan:', user.plan);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
