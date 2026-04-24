-- CreateEnum
CREATE TYPE "MarketplaceProvider" AS ENUM ('TRENDYOL', 'HEPiburada', 'N11', 'AMAZON');

-- CreateEnum
CREATE TYPE "MarketplaceSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "marketplace_accounts" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "MarketplaceProvider" NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_product_maps" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "MarketplaceProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_product_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "marketplace" "MarketplaceProvider" NOT NULL,
    "status" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "rawData" JSONB NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_sync_logs" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "marketplace" "MarketplaceProvider" NOT NULL,
    "syncType" "SyncType" NOT NULL,
    "status" "MarketplaceSyncStatus" NOT NULL,
    "entityId" TEXT,
    "externalId" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_categories" (
    "id" SERIAL NOT NULL,
    "marketplace" "MarketplaceProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_attributes" (
    "id" SERIAL NOT NULL,
    "marketplace" "MarketplaceProvider" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_accounts_tenantId_provider_key" ON "marketplace_accounts"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_product_maps_tenantId_marketplace_externalId_key" ON "marketplace_product_maps"("tenantId", "marketplace", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_product_maps_productId_marketplace_key" ON "marketplace_product_maps"("productId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_tenantId_marketplace_externalId_key" ON "marketplace_orders"("tenantId", "marketplace", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_externalId_marketplace_key" ON "marketplace_orders"("externalId", "marketplace");

-- CreateIndex
CREATE INDEX "marketplace_sync_logs_tenantId_marketplace_syncType_status_idx" ON "marketplace_sync_logs"("tenantId", "marketplace", "syncType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_categories_marketplace_externalId_key" ON "marketplace_categories"("marketplace", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_attributes_marketplace_categoryId_name_key" ON "marketplace_attributes"("marketplace", "categoryId", "name");

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_product_maps" ADD CONSTRAINT "marketplace_product_maps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_product_maps" ADD CONSTRAINT "marketplace_product_maps_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_product_maps" ADD CONSTRAINT "marketplace_product_maps_tenantId_marketplace_fkey" FOREIGN KEY ("tenantId", "marketplace") REFERENCES "marketplace_accounts"("tenantId", "provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_tenantId_marketplace_fkey" FOREIGN KEY ("tenantId", "marketplace") REFERENCES "marketplace_accounts"("tenantId", "provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sync_logs" ADD CONSTRAINT "marketplace_sync_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
