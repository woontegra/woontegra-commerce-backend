-- AlterTable
ALTER TABLE "customers" ADD COLUMN "kvkkConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "kvkkConsentAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "marketingConsentAt" TIMESTAMP(3);
