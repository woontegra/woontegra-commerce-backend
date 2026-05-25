-- AlterTable
ALTER TABLE "xml_sources"
ADD COLUMN     "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoSyncIntervalHours" INTEGER,
ADD COLUMN     "autoSyncAtHour" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "autoSyncAtMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autoSyncTimezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';

-- Index for autosync scanning
CREATE INDEX IF NOT EXISTS "xml_sources_autosync_idx"
ON "xml_sources"("isActive", "autoSyncEnabled", "tenantId");

