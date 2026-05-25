-- CreateTable
CREATE TABLE "xml_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "duplicateMode" TEXT NOT NULL DEFAULT 'update',
    "skipZeroStock" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xml_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "xml_sources_tenantId_url_key" ON "xml_sources"("tenantId", "url");

CREATE INDEX "xml_sources_tenantId_isActive_idx" ON "xml_sources"("tenantId", "isActive");

ALTER TABLE "xml_sources" ADD CONSTRAINT "xml_sources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
