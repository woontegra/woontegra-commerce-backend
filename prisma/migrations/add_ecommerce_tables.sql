-- Migration: Add E-commerce Tables
-- Date: 2026-04-05
-- Features: Coupons, Shipping Methods, Order Lifecycle, Checkout Rules

-- ============================================
-- COUPON SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL,
  
  -- Type & Value
  "type" TEXT NOT NULL, -- percentage, fixed
  "value" DECIMAL(10,2) NOT NULL,
  
  -- Restrictions
  "min_cart_total" DECIMAL(10,2),
  "max_discount_amount" DECIMAL(10,2),
  
  -- Usage Limits
  "max_usage" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "max_usage_per_user" INTEGER,
  
  -- Targeting
  "product_ids" TEXT[],
  "category_ids" TEXT[],
  "user_ids" TEXT[],
  
  -- Dates
  "start_date" TIMESTAMP NOT NULL,
  "end_date" TIMESTAMP NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  "description" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE("code", "tenant_id")
);

-- Coupon Usage Tracking
CREATE TABLE IF NOT EXISTS "coupon_usages" (
  "id" TEXT PRIMARY KEY,
  "coupon_id" TEXT NOT NULL REFERENCES "coupons"("id") ON DELETE CASCADE,
  "user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "order_id" TEXT REFERENCES "orders"("id") ON DELETE SET NULL,
  "discount_amount" DECIMAL(10,2) NOT NULL,
  "used_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SHIPPING SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS "shipping_methods" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  
  -- Price Type
  "price_type" TEXT NOT NULL, -- fixed, dynamic, free
  "base_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  -- Regions (JSON)
  "regions" JSONB,
  
  -- Free Shipping
  "free_shipping_threshold" DECIMAL(10,2),
  
  -- Weight Ranges (JSON)
  "weight_ranges" JSONB,
  
  -- Delivery Time
  "min_delivery_days" INTEGER NOT NULL DEFAULT 1,
  "max_delivery_days" INTEGER NOT NULL DEFAULT 7,
  
  -- Restrictions
  "max_cart_total" DECIMAL(10,2),
  "min_cart_total" DECIMAL(10,2),
  
  -- Status
  "active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  "icon" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ORDER LIFECYCLE
-- ============================================

-- Update orders table with lifecycle fields
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "status_history" JSONB DEFAULT '[]';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_number" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_company" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_url" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "estimated_delivery" TIMESTAMP;

-- ============================================
-- CHECKOUT RULES
-- ============================================

CREATE TABLE IF NOT EXISTS "checkout_rules" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  
  -- Rule Type
  "type" TEXT NOT NULL, -- min_total, max_total, payment_limit, shipping_limit, product_limit, category_limit
  "value" DECIMAL(10,2) NOT NULL,
  "condition" TEXT NOT NULL, -- min, max, equals
  
  -- Targeting
  "payment_methods" TEXT[],
  "shipping_methods" TEXT[],
  "product_ids" TEXT[],
  "category_ids" TEXT[],
  
  -- Status
  "active" BOOLEAN NOT NULL DEFAULT true,
  
  -- Error Message
  "error_message" TEXT NOT NULL,
  
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS "idx_coupons_tenant" ON "coupons"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_coupons_code" ON "coupons"("code");
CREATE INDEX IF NOT EXISTS "idx_coupons_active" ON "coupons"("active");
CREATE INDEX IF NOT EXISTS "idx_coupons_dates" ON "coupons"("start_date", "end_date");

CREATE INDEX IF NOT EXISTS "idx_coupon_usages_coupon" ON "coupon_usages"("coupon_id");
CREATE INDEX IF NOT EXISTS "idx_coupon_usages_user" ON "coupon_usages"("user_id");
CREATE INDEX IF NOT EXISTS "idx_coupon_usages_order" ON "coupon_usages"("order_id");

CREATE INDEX IF NOT EXISTS "idx_shipping_methods_tenant" ON "shipping_methods"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_shipping_methods_active" ON "shipping_methods"("active");

CREATE INDEX IF NOT EXISTS "idx_checkout_rules_tenant" ON "checkout_rules"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_checkout_rules_active" ON "checkout_rules"("active");

-- ============================================
-- NOTES
-- ============================================

-- This migration adds:
-- 1. Coupon System (coupons, coupon_usages)
-- 2. Shipping System (shipping_methods with region support)
-- 3. Order Lifecycle (status_history, tracking fields)
-- 4. Checkout Rules (validation rules for checkout)
--
-- To apply this migration:
-- 1. Update Prisma schema with these models
-- 2. Run: npx prisma db push
-- 3. Or create proper migration: npx prisma migrate dev --name add_ecommerce_tables
