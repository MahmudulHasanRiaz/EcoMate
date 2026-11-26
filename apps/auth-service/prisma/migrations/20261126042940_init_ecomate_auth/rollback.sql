-- Rollback for 20261126042940_init_ecomate_auth.
-- Drops every table the migration created (child tables first so the
-- foreign keys never block). Only for a pre-traffic rollback: the auth
-- service is unused until cutover, so dropping is safe while no client
-- points at it. Never run against a database holding live identities.
DROP TABLE IF EXISTS "login_lockout";
DROP TABLE IF EXISTS "twoFactor";
DROP TABLE IF EXISTS "invitation";
DROP TABLE IF EXISTS "member";
DROP TABLE IF EXISTS "organizationRole";
DROP TABLE IF EXISTS "organization";
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "user";
