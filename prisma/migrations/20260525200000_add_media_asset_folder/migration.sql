-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN "folder" TEXT NOT NULL DEFAULT 'general';

-- CreateIndex
CREATE INDEX "media_assets_tenantId_folder_idx" ON "media_assets"("tenantId", "folder");
