-- Session metadata on refresh tokens (CMS items 15/16): per-operator
-- session list + revoke needs device/IP/last-used per session. A session
-- is one refresh-token rotation family (familyId); the API groups rows by
-- family and revokes the whole family. Columns are nullable so pre-existing
-- tokens keep working; lastUsedAt backfills from createdAt (a token's last
-- use is at least its creation). userAgent is capped at 512 chars in code.
ALTER TABLE "PlatformRefreshToken" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "PlatformRefreshToken" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "PlatformRefreshToken" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

UPDATE "PlatformRefreshToken" SET "lastUsedAt" = "createdAt" WHERE "lastUsedAt" IS NULL;

-- CreateIndex
CREATE INDEX "PlatformRefreshToken_userId_lastUsedAt_idx" ON "PlatformRefreshToken"("userId", "lastUsedAt");
