const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const migrations = await p.$queryRawUnsafe(
    `SELECT migration_name, started_at, finished_at, rolled_back_at
     FROM "_prisma_migrations"
     WHERE finished_at IS NULL OR migration_name LIKE '%leads%' OR migration_name LIKE '%pricing%'
     ORDER BY started_at DESC LIMIT 25`,
  );
  console.log('Migrations:', JSON.stringify(migrations, null, 2));

  const tables = await p.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('leads','legal_acceptances','pricing_settings','pricing_rules')
     ORDER BY table_name`,
  );
  console.log('Tables:', JSON.stringify(tables, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
