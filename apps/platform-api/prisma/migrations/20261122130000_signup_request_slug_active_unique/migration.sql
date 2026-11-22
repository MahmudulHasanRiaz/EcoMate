-- Partial unique index: at most one ACTIVE signup request per slug
-- (PENDING_EMAIL or VERIFIED). EXPIRED/CANCELLED rows never block a slug,
-- so a re-signup after expiry does not hit the constraint.
--
-- This is the DB-level guard for the concurrent-submit race: two
-- simultaneous signups for the same slug can both pass assertAvailable
-- and both insert, and the loser would otherwise fail later at
-- provisioning when Tenant.slug (@unique) rejects — a 500-class failure
-- far from the user's action, after they already received a verification
-- email. With this index the loser fails at insert with P2002, which
-- SignupService.create() maps to the same 409 as assertAvailable.
--
-- Prisma cannot express partial indexes in the schema, so this index
-- lives only in this migration — the same pattern as
-- PaymentProof_methodId_transactionId_active_key and
-- BlogPost_slug_live_key. No data cleanup is needed: the SaaS has no
-- tenants yet and staging holds zero signups, so no duplicate active
-- slugs can exist.
CREATE UNIQUE INDEX "SignupRequest_slug_active_key"
ON "SignupRequest" ("slug")
WHERE "status" IN ('PENDING_EMAIL', 'VERIFIED');
