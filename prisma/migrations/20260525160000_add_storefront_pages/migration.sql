-- CreateTable
CREATE TABLE "storefront_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "draftJson" JSONB,
    "publishedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_pages_tenantId_idx" ON "storefront_pages"("tenantId");

-- CreateIndex
CREATE INDEX "storefront_pages_pageType_idx" ON "storefront_pages"("pageType");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_pages_tenantId_pageType_key" ON "storefront_pages"("tenantId", "pageType");

-- AddForeignKey
ALTER TABLE "storefront_pages" ADD CONSTRAINT "storefront_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
