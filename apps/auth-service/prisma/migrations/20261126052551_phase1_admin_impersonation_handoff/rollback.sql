-- Rollback for 20261126052551_phase1_admin_impersonation_handoff.
-- Drops the handoff table and the admin-plugin columns. Only for a
-- pre-traffic rollback: the auth service is unused until cutover, so
-- dropping is safe while no client points at it. Never run against a
-- database holding live identities.
DROP TABLE IF EXISTS "impersonation_handoff";
ALTER TABLE "user" DROP COLUMN IF EXISTS "role";
ALTER TABLE "user" DROP COLUMN IF EXISTS "banned";
ALTER TABLE "user" DROP COLUMN IF EXISTS "banReason";
ALTER TABLE "user" DROP COLUMN IF EXISTS "banExpires";
ALTER TABLE "session" DROP COLUMN IF EXISTS "impersonatedBy";
