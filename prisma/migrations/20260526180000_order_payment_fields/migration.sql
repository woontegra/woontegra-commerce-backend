-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'WAITING_BANK_TRANSFER', 'PAID', 'APPROVED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentProvider" "PaymentProviderType",
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" DEFAULT 'PENDING',
ADD COLUMN     "paymentApprovedAt" TIMESTAMP(3),
ADD COLUMN     "paymentFailedAt" TIMESTAMP(3),
ADD COLUMN     "bankTransferPendingEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "bankTransferApprovedEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "paymentReceivedEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "paymentFailedEmailSentAt" TIMESTAMP(3);
