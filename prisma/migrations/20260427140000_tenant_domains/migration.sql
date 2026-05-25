-- CreateEnum
CREATE TYPE "TenantDomainType" AS ENUM ('subdomain', 'custom');

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" "TenantDomainType" NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

CREATE INDEX "tenant_domains_tenantId_idx" ON "tenant_domains"("tenantId");

CREATE INDEX "tenant_domains_tenantId_type_idx" ON "tenant_domains"("tenantId", "type");

ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing tenant columns (idempotent-ish: skip if table already had rows from partial run)
INSERT INTO "tenant_domains" ("id", "tenantId", "domain", "type", "isVerified", "createdAt")
SELECT gen_random_uuid()::text, t."id", lower(trim(t."subdomain")), 'subdomain'::"TenantDomainType", true, NOW()
FROM "tenants" t
WHERE t."subdomain" IS NOT NULL AND trim(t."subdomain") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "tenant_domains" d
    WHERE d."tenantId" = t."id" AND d."type" = 'subdomain'::"TenantDomainType" AND d."domain" = lower(trim(t."subdomain"))
  );

INSERT INTO "tenant_domains" ("id", "tenantId", "domain", "type", "isVerified", "createdAt")
SELECT gen_random_uuid()::text, t."id", lower(trim(t."customDomain")), 'custom'::"TenantDomainType", COALESCE(t."domainVerified", false), NOW()
FROM "tenants" t
WHERE t."customDomain" IS NOT NULL AND trim(t."customDomain") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "tenant_domains" d WHERE d."domain" = lower(trim(t."customDomain"))
  );
