-- Coupon: başlangıç tarihi + müşteri başına kullanım limiti
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "usageLimitPerCustomer" INTEGER;
