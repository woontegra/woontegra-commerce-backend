-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_log_entries" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT,
    "traceId" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "message" TEXT NOT NULL,
    "errorMessage" TEXT,
    "stack" TEXT,
    "event" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_log_entries_tenantId_createdAt_idx" ON "platform_log_entries"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "platform_log_entries_level_createdAt_idx" ON "platform_log_entries"("level", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "platform_log_entries_module_idx" ON "platform_log_entries"("module");
CREATE INDEX IF NOT EXISTS "platform_log_entries_traceId_idx" ON "platform_log_entries"("traceId");
CREATE INDEX IF NOT EXISTS "platform_log_entries_event_createdAt_idx" ON "platform_log_entries"("event", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "platform_log_entries" ADD CONSTRAINT "platform_log_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
