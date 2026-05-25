import { PrismaClient } from '@prisma/client';

function integrationDatabaseUrl(): string {
  return (
    process.env.INTEGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://test:test@localhost:5432/woontegra_test'
  );
}

let prismaInstance: PrismaClient | null = null;

export function getIntegrationPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      datasources: { db: { url: integrationDatabaseUrl() } },
    });
  }
  return prismaInstance;
}

/** @deprecated getIntegrationPrisma() kullanın */
export const integrationPrisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getIntegrationPrisma() as Record<string | symbol, unknown>;
    const value = client[prop as string];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

/** Integration test tablolarını temizler (FK sırasına göre) */
export async function resetIntegrationDb(): Promise<void> {
  const prisma = getIntegrationPrisma();
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.trendyolProductPrice.deleteMany(),
    prisma.trendyolProductMap.deleteMany(),
    prisma.trendyolIntegration.deleteMany(),
    prisma.importLog.deleteMany(),
    prisma.productPrice.deleteMany(),
    prisma.stock.deleteMany(),
    prisma.productImage.deleteMany(),
    prisma.product.deleteMany(),
    prisma.user.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
}

/** Üretim / paylaşılan DB'ye yanlışlıkla truncate engeli */
export function isSafeIntegrationDatabase(url: string): boolean {
  const lower = url.toLowerCase();

  // Railway, Neon, Supabase vb. — asla otomatik temizlenmesin
  const productionLike =
    /railway\.app|rlwy\.net|neon\.tech|supabase\.co|amazonaws\.com|azure\.com/i.test(lower);
  if (productionLike) {
    if (process.env.ALLOW_INTEGRATION_ON_ANY_DB !== 'true') return false;
    console.error(
      '\n⛔ INTEGRATION TESTS BLOCKED: DATABASE_URL looks like a hosted/production database.\n' +
        '   Use a local test DB (woontegra_test) or set INTEGRATION_DATABASE_URL explicitly.\n' +
        '   NEVER set ALLOW_INTEGRATION_ON_ANY_DB=true against Railway/production.\n',
    );
    return false;
  }

  if (process.env.CI === 'true') return true;
  if (process.env.ALLOW_INTEGRATION_ON_ANY_DB === 'true') {
    console.warn(
      '\n⚠️  ALLOW_INTEGRATION_ON_ANY_DB=true — integration tests may DELETE ALL users/tenants in this database.\n',
    );
    return true;
  }
  return /_test|test_|woontegra_test|localhost|127\.0\.0\.1/i.test(lower);
}

/** CI veya RUN_INTEGRATION_TESTS=true iken PostgreSQL URL gerekir */
export function shouldRunIntegrationTests(): boolean {
  if (process.env.RUN_INTEGRATION_TESTS !== 'true' && process.env.CI !== 'true') {
    return false;
  }
  const url = integrationDatabaseUrl();
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) return false;
  return isSafeIntegrationDatabase(url);
}

export async function disconnectIntegrationDb(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
