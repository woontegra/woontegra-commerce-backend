import prisma from '../../config/database';
import { logger } from '../../config/logger';

let schemaSyncAttempted = false;
let schemaSyncOk = false;

/** Geliştirme ortamında migration atlanmışsa tabloyu idempotent oluşturur */
export async function ensureEmailTemplatesSchema(): Promise<boolean> {
  if (schemaSyncOk) return true;
  if (schemaSyncAttempted) return false;
  schemaSyncAttempted = true;

  try {
    await prisma.$executeRawUnsafe(`
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
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_tenantId_key_key"
        ON "email_templates"("tenantId", "key");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "email_templates_tenantId_isActive_idx"
        ON "email_templates"("tenantId", "isActive");
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "email_templates"
          ADD CONSTRAINT "email_templates_tenantId_fkey"
          FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "email_templates"
        ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "email_templates" SET "isSystem" = true
      WHERE "key" IN (
        'order_received', 'payment_success', 'payment_failed',
        'bank_transfer_pending', 'order_shipped', 'order_delivered',
        'order_cancelled', 'return_request_received', 'password_reset',
        'contact_form_notification'
      );
    `);

    schemaSyncOk = true;
    logger.info({ message: '[EmailTemplate] Şema senkronize edildi (email_templates)' });
    return true;
  } catch (err) {
    logger.warn({
      message: '[EmailTemplate] Şema senkronizasyonu başarısız',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}
