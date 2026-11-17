-- Rollback for 20261116223521_phase8_stage0_platform_security.
--
-- Drops the Stage 0 columns and indexes. Data loss notes:
-- * The isDefault flag is dropped with the column; re-running the migration
--   re-derives it from the trial plan (see the migration DML). If an
--   operator had set a different version as default, that choice is lost
--   and must be re-applied via the console after re-migrating.
-- * MFA state (mfaEnabledAt, pending secret, recovery codes) is dropped;
--   mfaSecret itself is NOT dropped (it predates this migration), but any
--   encrypted secret it holds becomes inert without mfaEnabledAt, and users
--   must re-enroll after re-migrating.
-- * Refresh-token families are dropped; existing refresh tokens keep
--   working (familyId is only used for reuse detection), but a replayed
--   token can no longer be attributed to a family until re-migrated.
-- * Login lockout state (failedLoginCount, lockedUntil) is dropped; any
--   active lockout is cleared by the rollback.

-- Drop the partial unique index first (it depends on the column).
DROP INDEX IF EXISTS "PlanVersion_single_default_idx";

-- DropIndex
DROP INDEX IF EXISTS "PlatformRefreshToken_familyId_idx";

-- AlterTable (reverse order of the migration)
ALTER TABLE "PlatformUser"
  DROP COLUMN IF EXISTS "failedLoginCount",
  DROP COLUMN IF EXISTS "lockedUntil",
  DROP COLUMN IF EXISTS "mfaEnabledAt",
  DROP COLUMN IF EXISTS "mfaPendingSecret",
  DROP COLUMN IF EXISTS "mfaRecoveryCodes";

ALTER TABLE "PlatformRefreshToken" DROP COLUMN IF EXISTS "familyId";

ALTER TABLE "PlanVersion" DROP COLUMN IF EXISTS "isDefault";
