-- Migration: Add Advanced E-commerce Features
-- Date: 2026-04-05
-- Features: Variant Groups, Marketing System, Advanced Campaigns

-- ============================================
-- VARIANT SYSTEM TABLES
-- ============================================

-- Variant Groups (Renk, Beden, Materyal, etc.)
CREATE TABLE IF NOT EXISTS "variant_groups" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Variant Options (Kırmızı, M, L, etc.)
CREATE TABLE IF NOT EXISTS "variant_options" (
  "id" TEXT PRIMARY KEY,
  "group_id" TEXT NOT NULL REFERENCES "variant_groups"("id") ON DELETE CASCADE,
  "value" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Update ProductVariant to use new system
-- (Already exists in schema, just documenting)
-- product_variants.combination stores JSON: {"Renk": "Kırmızı", "Beden": "M"}

-- ============================================
-- MARKETING SYSTEM TABLES
-- ============================================

-- Popup Campaigns
CREATE TABLE IF NOT EXISTS "popup_campaigns" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL, -- newsletter, discount, announcement, survey
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  
  -- Trigger Settings
  "trigger" TEXT NOT NULL, -- page_load, exit_intent, scroll, time_delay, click
  "trigger_value" INTEGER, -- scroll %, delay seconds
  
  -- Display Settings
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "image" TEXT,
  "button_text" TEXT NOT NULL,
  "button_link" TEXT,
  
  -- Email Collection
  "collect_email" BOOLEAN NOT NULL DEFAULT false,
  "email_placeholder" TEXT,
  
  -- Discount Code
  "discount_code" TEXT,
  "discount_amount" INTEGER,
  
  -- Targeting
  "show_on_pages" TEXT[], -- URL patterns
  "show_to_new_visitors" BOOLEAN DEFAULT true,
  "show_to_returning_visitors" BOOLEAN DEFAULT true,
  "max_display_per_user" INTEGER,
  
  -- Timing
  "start_date" TIMESTAMP,
  "end_date" TIMESTAMP,
  
  -- Stats
  "views" INTEGER NOT NULL DEFAULT 0,
  "conversions" INTEGER NOT NULL DEFAULT 0,
  
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Email Subscribers
CREATE TABLE IF NOT EXISTS "email_subscribers" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "source" TEXT NOT NULL, -- popup, footer, checkout, manual
  "tags" TEXT[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "subscribed_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unsubscribed_at" TIMESTAMP,
  
  UNIQUE("email", "tenant_id")
);

-- Abandoned Carts
CREATE TABLE IF NOT EXISTS "abandoned_carts" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "session_id" TEXT NOT NULL,
  "customer_id" TEXT REFERENCES "customers"("id") ON DELETE SET NULL,
  "customer_email" TEXT,
  
  "items" JSONB NOT NULL, -- Array of cart items
  "total_amount" DECIMAL(10,2) NOT NULL,
  
  -- Recovery
  "recovery_email_sent" BOOLEAN NOT NULL DEFAULT false,
  "recovery_email_sent_at" TIMESTAMP,
  "recovered" BOOLEAN NOT NULL DEFAULT false,
  "recovered_at" TIMESTAMP,
  "recovery_order_id" TEXT REFERENCES "orders"("id") ON DELETE SET NULL,
  
  "abandoned_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP NOT NULL,
  
  UNIQUE("session_id", "tenant_id")
);

-- ============================================
-- ADVANCED CAMPAIGN SYSTEM TABLES
-- ============================================

-- Advanced Campaigns (percentage, fixed, BXGY)
CREATE TABLE IF NOT EXISTS "advanced_campaigns" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  
  -- Type & Value
  "type" TEXT NOT NULL, -- percentage, fixed, bxgy
  "value" DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  -- BXGY Config
  "bxgy_buy" INTEGER, -- 3 al
  "bxgy_pay" INTEGER, -- 2 öde
  
  -- Dates
  "start_date" TIMESTAMP NOT NULL,
  "end_date" TIMESTAMP NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  
  -- Targeting
  "product_ids" TEXT[], -- Specific products
  "category_ids" TEXT[], -- Specific categories
  "user_group" TEXT, -- all, new, returning, vip
  "min_cart_amount" DECIMAL(10,2),
  "max_discount_amount" DECIMAL(10,2),
  
  -- Stats
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "total_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS "idx_variant_options_group" ON "variant_options"("group_id");
CREATE INDEX IF NOT EXISTS "idx_popup_campaigns_tenant" ON "popup_campaigns"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_popup_campaigns_active" ON "popup_campaigns"("is_active");
CREATE INDEX IF NOT EXISTS "idx_email_subscribers_tenant" ON "email_subscribers"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_email_subscribers_email" ON "email_subscribers"("email");
CREATE INDEX IF NOT EXISTS "idx_abandoned_carts_tenant" ON "abandoned_carts"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_abandoned_carts_session" ON "abandoned_carts"("session_id");
CREATE INDEX IF NOT EXISTS "idx_advanced_campaigns_tenant" ON "advanced_campaigns"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_advanced_campaigns_active" ON "advanced_campaigns"("active");
CREATE INDEX IF NOT EXISTS "idx_advanced_campaigns_dates" ON "advanced_campaigns"("start_date", "end_date");

-- ============================================
-- NOTES
-- ============================================

-- This migration adds:
-- 1. Variant Groups & Options for real e-commerce variant system
-- 2. Marketing System (Popup Campaigns, Email Subscribers, Abandoned Carts)
-- 3. Advanced Campaign Engine (percentage, fixed, BXGY with targeting)
--
-- To apply this migration:
-- 1. Update Prisma schema with these models
-- 2. Run: npx prisma db push
-- 3. Or create proper migration: npx prisma migrate dev --name add_advanced_features
