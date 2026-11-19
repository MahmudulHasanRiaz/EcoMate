-- Ad tracking dispatch (CMS batch 2, item 21): capture fields on Lead
-- (Meta fbp/fbc/eventId, TikTok ttclid/tiktokEventId) + the durable
-- AdDispatch retry queue (backoff 1m/5m/30m/2h/12h, mirror of the
-- reference dispatch_queue). DDL only — no data migration, no enum
-- change (platform/status are Strings validated at the API layer, so a
-- new platform needs no migration).
ALTER TABLE "Lead" ADD COLUMN "fbp" TEXT;
ALTER TABLE "Lead" ADD COLUMN "fbc" TEXT;
ALTER TABLE "Lead" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ttclid" TEXT;
ALTER TABLE "Lead" ADD COLUMN "tiktokEventId" TEXT;

-- CreateTable
CREATE TABLE "AdDispatch" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdDispatch_leadId_platform_eventName_key" ON "AdDispatch"("leadId", "platform", "eventName");

-- CreateIndex
CREATE INDEX "AdDispatch_status_nextRetryAt_idx" ON "AdDispatch"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "AdDispatch" ADD CONSTRAINT "AdDispatch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
