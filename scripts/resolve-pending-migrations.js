const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CHECKS = {
  '20260427120000_tenant_usage_logs': `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenant_usage_logs'
  ) AS ok`,
  '20260427140000_tenant_domains': `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenant_domains'
  ) AS ok`,
  '20260427150000_xml_sources': `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='xml_sources'
  ) AS ok`,
  '20260427160000_tenant_store_theme': `SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='theme'
  ) AS ok`,
  '20260427163000_xml_source_autosync': `SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='xml_sources' AND column_name='autoSyncEnabled'
  ) AS ok`,
  '20260523120000_pricing_rules': `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pricing_rules'
  ) AS ok`,
  '20260523140000_pricing_settings': `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pricing_settings'
  ) AS ok`,
};

async function main() {
  const pending = await p.$queryRawUnsafe(
    `SELECT m.migration_name
     FROM (
       SELECT unnest(ARRAY[
         '20260427120000_tenant_usage_logs',
         '20260427140000_tenant_domains',
         '20260427150000_xml_sources',
         '20260427160000_tenant_store_theme',
         '20260427163000_xml_source_autosync',
         '20260523120000_pricing_rules',
         '20260523140000_pricing_settings'
       ]) AS migration_name
     ) m
     LEFT JOIN "_prisma_migrations" pm ON pm.migration_name = m.migration_name AND pm.finished_at IS NOT NULL
     WHERE pm.migration_name IS NULL`,
  );

  for (const row of pending) {
    const name = row.migration_name;
    const sql = CHECKS[name];
    if (!sql) continue;
    const [{ ok }] = await p.$queryRawUnsafe(sql);
    if (ok) {
      console.log(`Marking applied (already in DB): ${name}`);
      execSync(`npx prisma migrate resolve --applied ${name}`, { stdio: 'inherit' });
    } else {
      console.log(`Will need deploy: ${name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
