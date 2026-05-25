import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] ?? 'admin@woontegra.com';
  const total = await prisma.user.count();
  const exact = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      isActive: true,
      createdAt: true,
    },
  });
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'OWNER'] } },
    select: { email: true, role: true, isActive: true },
    take: 15,
  });

  console.log(JSON.stringify({ total, searchEmail: email, matches: exact, superAdmins: admins }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
