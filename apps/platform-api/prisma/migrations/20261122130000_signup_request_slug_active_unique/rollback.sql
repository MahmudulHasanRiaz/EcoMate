-- Rollback for 20261122130000_signup_request_slug_active_unique (DDL only).
-- Drops the partial unique index on active signup slugs. No data is lost;
-- the only effect is that the concurrent-submit race is unguarded again
-- (the loser fails later, at provisioning, as before).
DROP INDEX IF EXISTS "SignupRequest_slug_active_key";
