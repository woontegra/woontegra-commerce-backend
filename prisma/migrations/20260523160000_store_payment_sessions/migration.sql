-- CreateEnum
CREATE TYPE "StorePaymentSessionStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "store_payment_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PAYTR',
    "merchantOid" TEXT NOT NULL,
    "amountKurus" INTEGER NOT NULL,
    "status" "StorePaymentSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_payment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_sessions_merchantOid_key" ON "store_payment_sessions"("merchantOid");

-- CreateIndex
CREATE INDEX "store_payment_sessions_tenantId_orderId_idx" ON "store_payment_sessions"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "store_payment_sessions_orderId_status_idx" ON "store_payment_sessions"("orderId", "status");

-- AddForeignKey
ALTER TABLE "store_payment_sessions" ADD CONSTRAINT "store_payment_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_payment_sessions" ADD CONSTRAINT "store_payment_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
