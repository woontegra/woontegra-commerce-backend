-- AlterTable
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "content" TEXT NOT NULL DEFAULT '';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "excerpt" TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "metaTitle" TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "metaDescription" TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "showInHeader" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "showInFooter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Sync legacy isPublished from status
UPDATE "pages" SET "status" = 'published', "isPublished" = true WHERE "isPublished" = true AND "status" = 'draft';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pages_tenantId_status_idx" ON "pages"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "pages_tenantId_sortOrder_idx" ON "pages"("tenantId", "sortOrder");
