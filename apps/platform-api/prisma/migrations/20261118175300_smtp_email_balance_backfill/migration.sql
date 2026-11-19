-- SMTP email balance backfill (smtp-balance-design.md §14 step 2, §6).
-- Data only; the DDL lives in 20261118175200_smtp_email_balance.
-- Idempotent: every statement guards on state the backfill itself sets
-- (ON CONFLICT / freeGrantClaimed / NOT EXISTS), so a re-run after a
-- partial failure grants nothing twice. The whole file runs in one
-- transaction (prisma migrate deploy), so a failure rolls everything back.
--
-- The free grant is 10 emails — the default freeAllowance in the seeded
-- saas_smtp setting below. pricePerUnit is null: top-ups stay disabled
-- until the operator sets a rate (the safe default).

-- 1. Seed the saas_smtp setting with safe defaults.
INSERT INTO "PlatformSetting" ("key", "value", "updatedAt")
VALUES (
  'saas_smtp',
  '{"unit":"PER_EMAIL","pricePerUnit":null,"freeAllowance":10,"lowBalanceThreshold":10,"expiry":{"mode":"NONE","days":90,"warnDays":7}}'::jsonb,
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

-- 2. Email accounts for existing tenants (DELETED tenants get nothing).
INSERT INTO "TenantEmailAccount" ("tenantId", "balanceCached", "freeGrantClaimed", "updatedAt")
SELECT id, 0, false, NOW() FROM "Tenant" WHERE status <> 'DELETED'
ON CONFLICT ("tenantId") DO NOTHING;

-- 3. Free-grant lots (10 emails, never expiring — mode NONE is the
-- default) + their GRANT ledger rows, for tenants that have not claimed
-- one. The NOT EXISTS guard makes the grant safe even if this file is
-- ever applied outside the single-transaction guarantee.
WITH granted AS (
  INSERT INTO "EmailBalanceLot"
    ("id", "tenantId", "source", "emailsTotal", "emailsRemaining", "expiresAt", "createdAt")
  SELECT gen_random_uuid(), t.id, 'FREE_GRANT', 10, 10, NULL, NOW()
  FROM "Tenant" t
  JOIN "TenantEmailAccount" a ON a."tenantId" = t.id
  WHERE t.status <> 'DELETED'
    AND a."freeGrantClaimed" = false
    AND NOT EXISTS (
      SELECT 1 FROM "EmailBalanceLot" l
      WHERE l."tenantId" = t.id AND l.source = 'FREE_GRANT'
    )
  RETURNING id, "tenantId"
)
INSERT INTO "EmailBalanceLedger"
  ("id", "tenantId", "lotId", "kind", "delta", "balanceAfter", "reference", "createdAt")
SELECT gen_random_uuid(), "tenantId", id, 'GRANT', 10, 10, 'backfill:free-grant', NOW()
FROM granted;

-- 4. Flip the cache + claim flag for the tenants granted above.
UPDATE "TenantEmailAccount" a
SET "balanceCached" = a."balanceCached" + 10,
    "freeGrantClaimed" = true,
    "updatedAt" = NOW()
FROM "EmailBalanceLot" l
WHERE l."tenantId" = a."tenantId"
  AND l.source = 'FREE_GRANT'
  AND a."freeGrantClaimed" = false;
