-- Storefront tema anahtarı (çok kiracılı mağaza vitrinleri)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'default';
