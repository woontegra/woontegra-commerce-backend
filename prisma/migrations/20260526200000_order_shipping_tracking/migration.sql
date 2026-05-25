-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shippingCarrier" TEXT,
ADD COLUMN     "shippingTrackingNumber" TEXT,
ADD COLUMN     "shippingTrackingUrl" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippingNotificationSentAt" TIMESTAMP(3);
