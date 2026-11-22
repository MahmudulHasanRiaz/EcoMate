-- Rollback for 20261122120000_platform_user_avatar_key (DDL only).
-- Drops the avatarKey column and its index. Any custom avatars set
-- while the migration was applied are lost (users fall back to
-- Gravatar/initials); the media assets themselves are untouched, so
-- operators can re-pick their photo after re-applying.
DROP INDEX IF EXISTS "PlatformUser_avatarKey_idx";
ALTER TABLE "PlatformUser" DROP COLUMN IF EXISTS "avatarKey";
