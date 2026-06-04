-- Sistem / özel şablon ayrımı
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

UPDATE "email_templates" SET "isSystem" = true
WHERE "key" IN (
  'order_received',
  'payment_success',
  'payment_failed',
  'bank_transfer_pending',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'return_request_received',
  'password_reset',
  'contact_form_notification'
);
