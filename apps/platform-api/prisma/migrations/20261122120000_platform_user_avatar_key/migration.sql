-- PlatformUser.avatarKey: custom avatar stored as a MediaAsset.objectKey
-- (a KEY, never a URL — StackMate M-23 pattern). Null = no custom photo;
-- the console falls back to Gravatar, then initials. No backfill needed:
-- every existing user correctly has NULL.
ALTER TABLE "PlatformUser" ADD COLUMN "avatarKey" TEXT;

-- Media delete clears avatars by key (MediaService.delete).
CREATE INDEX "PlatformUser_avatarKey_idx" ON "PlatformUser"("avatarKey");
