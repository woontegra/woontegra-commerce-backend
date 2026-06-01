-- CreateEnum
CREATE TYPE "SupportMessageSenderType" AS ENUM ('USER', 'SUPPORT');

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderType" "SupportMessageSenderType" NOT NULL DEFAULT 'USER',
    "senderUserId" TEXT,
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticketId_idx" ON "support_ticket_messages"("ticketId");

-- CreateIndex
CREATE INDEX "support_ticket_messages_tenantId_idx" ON "support_ticket_messages"("tenantId");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticketId_createdAt_idx" ON "support_ticket_messages"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill initial messages from existing tickets
INSERT INTO "support_ticket_messages" ("id", "ticketId", "tenantId", "senderType", "senderUserId", "message", "isInternal", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    t."id",
    t."tenantId",
    'USER'::"SupportMessageSenderType",
    t."createdByUserId",
    t."message",
    false,
    t."createdAt",
    t."updatedAt"
FROM "support_tickets" t
WHERE NOT EXISTS (
    SELECT 1 FROM "support_ticket_messages" m WHERE m."ticketId" = t."id"
);
