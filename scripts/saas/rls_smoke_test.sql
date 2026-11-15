-- Two-tenant RLS smoke test.
-- Run only against a disposable database after 0001_saas_baseline and
-- 0002_rls_and_tenant_guards have been applied.
--
--   psql -v ON_ERROR_STOP=1 -f scripts/saas/rls_smoke_test.sql
--
-- The script exits non-zero if any isolation assertion fails.

\set ON_ERROR_STOP on

SET ROLE ecomate_app;

-- Tenant A and B. The trigger sets tenant_id from app.tenant_id; an explicit
-- tenant_id is overwritten, so a caller cannot write into another tenant.
SET app.tenant_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
VALUES ('probe', 'tenant-A', now());

SET app.tenant_id = '22222222-2222-4222-8222-222222222222';
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
VALUES ('probe', 'tenant-B', now());

-- Tenant B sees exactly its own row.
DO $$
DECLARE
  c int;
  v text;
BEGIN
  SELECT count(*), max(value) INTO c, v FROM "SystemSetting";
  IF c <> 1 OR v <> 'tenant-B' THEN
    RAISE EXCEPTION 'tenant B isolation failed: rows=%, value=%', c, v;
  END IF;
END $$;

-- Tenant A sees exactly its own row; a raw cross-tenant predicate still
-- returns zero because RLS is applied before the predicate.
SET app.tenant_id = '11111111-1111-4111-8111-111111111111';
DO $$
DECLARE
  c int;
  v text;
  cross_count int;
BEGIN
  SELECT count(*), max(value) INTO c, v FROM "SystemSetting";
  IF c <> 1 OR v <> 'tenant-A' THEN
    RAISE EXCEPTION 'tenant A isolation failed: rows=%, value=%', c, v;
  END IF;

  SELECT count(*) INTO cross_count
  FROM "SystemSetting"
  WHERE "tenant_id" = '22222222-2222-4222-8222-222222222222';
  IF cross_count <> 0 THEN
    RAISE EXCEPTION 'raw cross-tenant read leaked % rows', cross_count;
  END IF;
END $$;

-- A cross-tenant UPDATE affects only the current tenant's row.
UPDATE "SystemSetting" SET value = 'tenant-A-updated' WHERE "key" = 'probe';
SET app.tenant_id = '22222222-2222-4222-8222-222222222222';
DO $$
DECLARE
  v text;
BEGIN
  SELECT value INTO v FROM "SystemSetting" WHERE "key" = 'probe';
  IF v <> 'tenant-B' THEN
    RAISE EXCEPTION 'cross-tenant update leaked into tenant B: %', v;
  END IF;
END $$;

-- An explicit foreign tenant_id is coerced to the current tenant.
SET app.tenant_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO "SystemSetting" ("tenant_id", "key", "value", "updatedAt")
VALUES ('22222222-2222-4222-8222-222222222222', 'override', 'x', now());
DO $$
DECLARE
  t text;
BEGIN
  SELECT "tenant_id"::text INTO t FROM "SystemSetting" WHERE "key" = 'override';
  IF t <> '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'tenant_id override was not coerced: %', t;
  END IF;
END $$;

-- UsageCounter uses the same (metric, period) in two tenants: the composite
-- unique includes tenant_id, so both rows coexist.
SET app.tenant_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO "UsageCounter" ("id", "metric", "periodStart", "value", "updatedAt")
VALUES (gen_random_uuid(), 'orders', '2026-11-01', 1, now());
SET app.tenant_id = '22222222-2222-4222-8222-222222222222';
INSERT INTO "UsageCounter" ("id", "metric", "periodStart", "value", "updatedAt")
VALUES (gen_random_uuid(), 'orders', '2026-11-01', 2, now());
DO $$
DECLARE
  c int;
  v bigint;
BEGIN
  SELECT count(*), max(value) INTO c, v FROM "UsageCounter";
  IF c <> 1 OR v <> 2 THEN
    RAISE EXCEPTION 'UsageCounter tenant isolation failed: rows=%, value=%', c, v;
  END IF;
END $$;

-- TenantEntitlementCache has tenant_id as its primary key. A foreign explicit
-- tenant_id is coerced to the current tenant rather than inserted cross-tenant.
SET app.tenant_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO "TenantEntitlementCache" ("tenant_id", "snapshot", "updatedAt")
VALUES ('22222222-2222-4222-8222-222222222222', '{"probe":true}'::jsonb, now());
DO $$
DECLARE
  t text;
BEGIN
  SELECT "tenant_id"::text INTO t FROM "TenantEntitlementCache";
  IF t <> '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'entitlement cache override was not coerced: %', t;
  END IF;
END $$;

-- Global reference tables are intentionally RLS-exempt and readable by the app
-- role. They have no tenant_id column.
DO $$
BEGIN
  PERFORM count(*) FROM "PaymentOption";
  PERFORM count(*) FROM "SourcePlatform";
  PERFORM count(*) FROM "MarketingPlatform";
END $$;

-- No tenant context: reads return zero and inserts fail closed.
RESET app.tenant_id;
DO $$
DECLARE
  c int;
BEGIN
  SELECT count(*) INTO c FROM "SystemSetting";
  IF c <> 0 THEN
    RAISE EXCEPTION 'no-context read returned % rows', c;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
    VALUES ('no-context', 'x', now());
    RAISE EXCEPTION 'insert without tenant context unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT LIKE '%tenant context missing%'
         AND SQLERRM NOT LIKE '%not-null%' THEN
        RAISE;
      END IF;
  END;
END $$;

RESET ROLE;
SELECT 'RLS smoke test PASS' AS result;
