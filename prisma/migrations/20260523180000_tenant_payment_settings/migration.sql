-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('PAYTR', 'IYZICO', 'BANK_POS', 'BANK_TRANSFER', 'CASH_ON_DELIVERY');

-- CreateTable
CREATE TABLE "tenant_payment_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isTestMode" BOOLEAN NOT NULL DEFAULT true,
    "displayName" TEXT,
    "credentialsEncrypted" TEXT,
    "publicConfigJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_settings_tenantId_provider_key" ON "tenant_payment_settings"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "tenant_payment_settings_tenantId_isActive_idx" ON "tenant_payment_settings"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "tenant_payment_settings" ADD CONSTRAINT "tenant_payment_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
