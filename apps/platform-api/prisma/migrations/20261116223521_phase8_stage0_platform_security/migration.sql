-- Phase 8 Stage 0 — platform-api security (items 1, 8, 10, 11).
--
-- * PlatformUser.failedLoginCount / lockedUntil — per-account progressive
--   login lockout (item 1). Lookups are by user id / email (unique), so no
--   new index is needed. The new auth.login.failed/success audit events are
--   served by the existing AuditLog(action, createdAt) index.
-- * PlatformUser.mfaEnabledAt / mfaPendingSecret / mfaRecoveryCodes — TOTP
--   MFA (item 10). mfaSecret already existed (dead field); the secrets are
--   AES-256-GCM ciphertext (enc:v1: prefix) and recovery codes are SHA-256
--   hashes. No new index: all reads are by user id.
-- * PlanVersion.isDefault — explicit signup default (item 8, D3). At most
--   one version may be the default: enforced by the PARTIAL unique index
--   below (Prisma has no partial-index support). The DML at the end marks
--   the trial plan's current version as the default; it is a no-op when no
--   trial plan exists yet (the seed sets the flag then).
-- * PlatformRefreshToken.familyId — rotation family for refresh-token reuse
--   detection (item 11). Existing rows get a fresh UUID each via the DB
--   default, matching the Prisma @default(uuid()) on new rows.
--
-- No enum changes, so no ADD VALUE / DML separation concern applies.

-- AlterTable
ALTER TABLE "PlanVersion" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- The DB default (not just the Prisma-level one) backfills existing rows;
-- without it this statement fails on a non-empty table.
ALTER TABLE "PlatformRefreshToken" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN "mfaPendingSecret" TEXT,
ADD COLUMN "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "PlatformRefreshToken_familyId_idx" ON "PlatformRefreshToken"("familyId");

-- At most one signup-default plan version. The partial index only contains
-- rows with isDefault = true, so the single-column uniqueness means at most
-- one such row exists. It also serves the provisioning lookup
-- (findFirst isDefault = true).
CREATE UNIQUE INDEX "PlanVersion_single_default_idx" ON "PlanVersion"("isDefault") WHERE "isDefault" = true;

-- Mark the trial plan's current (highest non-archived) version as the
-- signup default. No-op when the trial plan (or any version) is absent.
UPDATE "PlanVersion" pv
SET "isDefault" = true
FROM "Plan" p
WHERE pv."planId" = p.id
  AND p.slug = 'trial'
  AND pv."archivedAt" IS NULL
  AND pv.version = (
    SELECT MAX(pv2.version)
    FROM "PlanVersion" pv2
    WHERE pv2."planId" = p.id
      AND pv2."archivedAt" IS NULL
  );
