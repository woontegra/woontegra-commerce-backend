-- CreateEnum
CREATE TYPE "TenantUsageAction" AS ENUM ('LOGIN', 'PRODUCT_CREATE', 'ORDER_CREATE');

-- CreateTable
CREATE TABLE "tenant_usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" "TenantUsageAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_usage_logs_tenantId_action_idx" ON "tenant_usage_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "tenant_usage_logs_tenantId_createdAt_idx" ON "tenant_usage_logs"("tenantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "tenant_usage_logs" ADD CONSTRAINT "tenant_usage_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
