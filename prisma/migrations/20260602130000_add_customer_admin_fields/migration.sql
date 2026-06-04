-- AlterTable
ALTER TABLE "customers" ADD COLUMN "internalNote" TEXT;
ALTER TABLE "customers" ADD COLUMN "isRisky" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "blockedReason" TEXT;
