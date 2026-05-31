-- CreateEnum
CREATE TYPE "MarketplaceQuestionSource" AS ENUM ('TRENDYOL', 'HEPSIBURADA', 'N11', 'PAZARAMA', 'WOONTEGRA', 'AMAZON');

-- CreateEnum
CREATE TYPE "MarketplaceQuestionType" AS ENUM ('PRODUCT_QUESTION', 'ORDER_QUESTION');

-- CreateEnum
CREATE TYPE "MarketplaceQuestionStatus" AS ENUM ('WAITING_ANSWER', 'PENDING_APPROVAL', 'ANSWERED', 'EXPIRED', 'CLOSED');

-- CreateTable
CREATE TABLE "marketplace_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "MarketplaceQuestionSource" NOT NULL,
    "type" "MarketplaceQuestionType" NOT NULL DEFAULT 'PRODUCT_QUESTION',
    "externalQuestionId" TEXT NOT NULL,
    "externalStatus" TEXT,
    "status" "MarketplaceQuestionStatus" NOT NULL,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT,
    "customerName" TEXT,
    "customerId" TEXT,
    "productName" TEXT,
    "barcode" TEXT,
    "externalProductId" TEXT,
    "externalOrderId" TEXT,
    "productId" TEXT,
    "orderId" TEXT,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_questions_tenantId_idx" ON "marketplace_questions"("tenantId");

-- CreateIndex
CREATE INDEX "marketplace_questions_source_idx" ON "marketplace_questions"("source");

-- CreateIndex
CREATE INDEX "marketplace_questions_type_idx" ON "marketplace_questions"("type");

-- CreateIndex
CREATE INDEX "marketplace_questions_status_idx" ON "marketplace_questions"("status");

-- CreateIndex
CREATE INDEX "marketplace_questions_askedAt_idx" ON "marketplace_questions"("askedAt");

-- CreateIndex
CREATE INDEX "marketplace_questions_barcode_idx" ON "marketplace_questions"("barcode");

-- CreateIndex
CREATE INDEX "marketplace_questions_productId_idx" ON "marketplace_questions"("productId");

-- CreateIndex
CREATE INDEX "marketplace_questions_orderId_idx" ON "marketplace_questions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_questions_tenantId_source_externalQuestionId_key" ON "marketplace_questions"("tenantId", "source", "externalQuestionId");

-- AddForeignKey
ALTER TABLE "marketplace_questions" ADD CONSTRAINT "marketplace_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_questions" ADD CONSTRAINT "marketplace_questions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
