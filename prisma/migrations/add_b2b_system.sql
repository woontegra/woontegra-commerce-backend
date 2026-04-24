-- B2B System Migration
-- Add CustomerGroup model and update existing models

-- Customer Groups (Perakende, Bayi, VIP)
CREATE TABLE "customer_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "customer_groups_tenantId_idx" ON "customer_groups"("tenantId");
CREATE UNIQUE INDEX "customer_groups_name_tenantId_key" ON "customer_groups"("name", "tenantId");

-- Add groupId to Customer table
ALTER TABLE "customers" ADD COLUMN "groupId" TEXT;

-- Add foreign key constraint
ALTER TABLE "customers" ADD CONSTRAINT "customers_groupId_fkey" 
    FOREIGN KEY ("groupId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add wholesalePrice and groupPrices to ProductVariant table
ALTER TABLE "product_variants" ADD COLUMN "wholesalePrice" DECIMAL(10,2);
ALTER TABLE "product_variants" ADD COLUMN "groupPrices" JSON;

-- Insert default customer groups for each tenant
INSERT INTO "customer_groups" ("id", "name", "tenantId", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    grp.name,
    tenant.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT 'Perakende' as name UNION ALL
    SELECT 'Bayi' as name UNION ALL  
    SELECT 'VIP' as name
) grp
CROSS JOIN "tenants" tenant
WHERE NOT EXISTS (
    SELECT 1 FROM "customer_groups" cg 
    WHERE cg.name = grp.name AND cg.tenantId = tenant.id
);

-- Update existing customers to have 'Perakende' as default group
UPDATE "customers" 
SET "groupId" = cg.id
FROM "customer_groups" cg
WHERE cg.name = 'Perakende' 
AND cg.tenantId = "customers"."tenantId"
AND "customers"."groupId" IS NULL;
