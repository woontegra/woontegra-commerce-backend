-- Mağaza siparişi satıcı fatura bilgileri (SaaS abonelik Invoice tablosundan bağımsız)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "invoiceUrl" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "invoiceUploadedAt" TIMESTAMP(3);
