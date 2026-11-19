-- Rollback for 20261119103000_platform_session_metadata.
-- Drops the session-metadata columns and index. Device/IP/last-used
-- history is lost; the tokens themselves (and their families, expiry and
-- revocation state) are untouched, so live sessions keep working.
DROP INDEX IF EXISTS "PlatformRefreshToken_userId_lastUsedAt_idx";
ALTER TABLE "PlatformRefreshToken" DROP COLUMN IF EXISTS "lastUsedAt";
ALTER TABLE "PlatformRefreshToken" DROP COLUMN IF EXISTS "ipAddress";
ALTER TABLE "PlatformRefreshToken" DROP COLUMN IF EXISTS "userAgent";
