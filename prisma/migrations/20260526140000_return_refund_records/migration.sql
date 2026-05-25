-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('MANUAL_BANK_TRANSFER', 'CASH', 'PAYTR_MANUAL', 'IYZICO_MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundRecordStatus" AS ENUM ('RECORDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "return_refund_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "method" "RefundMethod" NOT NULL,
    "status" "RefundRecordStatus" NOT NULL DEFAULT 'RECORDED',
    "note" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_refund_records_tenantId_returnRequestId_idx" ON "return_refund_records"("tenantId", "returnRequestId");

-- CreateIndex
CREATE INDEX "return_refund_records_returnRequestId_status_idx" ON "return_refund_records"("returnRequestId", "status");

-- AddForeignKey
ALTER TABLE "return_refund_records" ADD CONSTRAINT "return_refund_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_refund_records" ADD CONSTRAINT "return_refund_records_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "order_return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_refund_records" ADD CONSTRAINT "return_refund_records_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_refund_records" ADD CONSTRAINT "return_refund_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
