-- Rollback for 20261118175300_smtp_email_balance_backfill.
-- Removes exactly what the backfill added: the seeded saas_smtp setting,
-- the backfill GRANT ledger rows + their lots, and the claim flag /
-- cached balance on accounts whose ONLY lot was the backfill lot.
-- Accounts that gained other lots after the backfill keep their state
-- (their backfill lot is still removed and 10 is subtracted from the
-- cache, but freeGrantClaimed stays true — the tenant did receive the
-- grant). Run this BEFORE the DDL rollback (which drops the tables).
WITH backfilled AS (
  SELECT DISTINCT "tenantId", "lotId"
  FROM "EmailBalanceLedger"
  WHERE reference = 'backfill:free-grant'
),
touched AS (
  SELECT DISTINCT "tenantId" FROM backfilled
)
UPDATE "TenantEmailAccount" a
SET "balanceCached" = GREATEST(0, a."balanceCached" - 10),
    "freeGrantClaimed" = CASE
      WHEN EXISTS (
        SELECT 1 FROM "EmailBalanceLot" l
        WHERE l."tenantId" = a."tenantId"
          AND l.id NOT IN (SELECT "lotId" FROM backfilled WHERE "lotId" IS NOT NULL)
      ) THEN true
      ELSE false
    END,
    "updatedAt" = NOW()
FROM touched t
WHERE t."tenantId" = a."tenantId";

DELETE FROM "EmailBalanceLot"
WHERE id IN (
  SELECT "lotId" FROM "EmailBalanceLedger"
  WHERE reference = 'backfill:free-grant' AND "lotId" IS NOT NULL
);

DELETE FROM "EmailBalanceLedger" WHERE reference = 'backfill:free-grant';

DELETE FROM "PlatformSetting" WHERE "key" = 'saas_smtp';
