-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ORDER_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CANCELED';
ALTER TYPE "NotificationType" ADD VALUE 'TRIAL_ENDING_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TRIAL_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANT_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'USER_BANNED';
