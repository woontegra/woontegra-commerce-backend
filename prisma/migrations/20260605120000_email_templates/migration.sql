-- Tenant e-posta şablonları
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "bodyHtml" TEXT NOT NULL,
  "bodyText" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_tenantId_key_key" ON "email_templates"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "email_templates_tenantId_isActive_idx" ON "email_templates"("tenantId", "isActive");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
