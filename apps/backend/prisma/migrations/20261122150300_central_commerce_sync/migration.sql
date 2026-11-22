-- Central Commerce (Phase 9) — P4 sync runs/attempts/issues + webhook deliveries.
-- Every new table carries tenant_id + tenant-first indexes + RLS
-- (ENABLE + FORCE + tenant_isolation policy + tenant_id_guard trigger)
-- in its FIRST migration (§3.12.2). The `rls_coverage` view + boot gate
-- refuse to start if any of those is missing.
--
-- The ~200 `ALTER COLUMN "tenant_id" SET DEFAULT` statements Prisma's
-- diff engine also generates are stripped deliberately (see
-- 20261122150000_central_commerce_enums): Postgres normalizes '' to
-- ''::text on store, so they can never converge and change nothing.


-- CreateTable
CREATE TABLE "SyncRun" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "scope" "SyncRunScope" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerType" "SyncTriggerType" NOT NULL DEFAULT 'MANUAL',
    "storeId" TEXT,
    "initiatedById" TEXT,
    "windowDays" INTEGER,
    "wideningReason" TEXT,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "errorCategory" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRunItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "storeId" TEXT,
    "productId" TEXT,
    "objectType" "SyncObjectType" NOT NULL,
    "externalObjectId" TEXT,
    "status" "SyncItemStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "field" TEXT,
    "auditLevel" TEXT,
    "durationMs" INTEGER,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAttempt" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "storeId" TEXT,
    "objectType" "SyncObjectType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "productId" TEXT,
    "field" TEXT,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "status" "SyncItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSyncIssue" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "objectType" "SyncObjectType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "productId" TEXT,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "status" "SyncIssueStatus" NOT NULL DEFAULT 'OPEN',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,

    CONSTRAINT "StoreSyncIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreWebhookDelivery" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "retryKey" TEXT,
    "topic" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_tenant_id_storeId_startedAt_idx" ON "SyncRun"("tenant_id", "storeId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_tenant_id_scope_status_idx" ON "SyncRun"("tenant_id", "scope", "status");

-- CreateIndex
CREATE INDEX "SyncRun_tenant_id_startedAt_idx" ON "SyncRun"("tenant_id", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRunItem_tenant_id_runId_idx" ON "SyncRunItem"("tenant_id", "runId");

-- CreateIndex
CREATE INDEX "SyncRunItem_tenant_id_storeId_productId_idx" ON "SyncRunItem"("tenant_id", "storeId", "productId");

-- CreateIndex
CREATE INDEX "SyncRunItem_tenant_id_status_idx" ON "SyncRunItem"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "SyncAttempt_tenant_id_storeId_objectKey_idx" ON "SyncAttempt"("tenant_id", "storeId", "objectKey");

-- CreateIndex
CREATE INDEX "SyncAttempt_tenant_id_runId_idx" ON "SyncAttempt"("tenant_id", "runId");

-- CreateIndex
CREATE INDEX "SyncAttempt_tenant_id_status_nextRetryAt_idx" ON "SyncAttempt"("tenant_id", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SyncAttempt_tenant_id_createdAt_idx" ON "SyncAttempt"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "StoreSyncIssue_tenant_id_storeId_status_idx" ON "StoreSyncIssue"("tenant_id", "storeId", "status");

-- CreateIndex
CREATE INDEX "StoreSyncIssue_tenant_id_status_idx" ON "StoreSyncIssue"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSyncIssue_storeId_code_objectKey_key" ON "StoreSyncIssue"("storeId", "code", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoreWebhookDelivery_deliveryKey_key" ON "StoreWebhookDelivery"("deliveryKey");

-- CreateIndex
CREATE INDEX "StoreWebhookDelivery_tenant_id_storeId_idx" ON "StoreWebhookDelivery"("tenant_id", "storeId");

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRunItem" ADD CONSTRAINT "SyncRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSyncIssue" ADD CONSTRAINT "StoreSyncIssue_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreWebhookDelivery" ADD CONSTRAINT "StoreWebhookDelivery_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "SyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SyncRun";
CREATE POLICY tenant_isolation ON "SyncRun"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "SyncRun";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "SyncRun"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "SyncRunItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncRunItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SyncRunItem";
CREATE POLICY tenant_isolation ON "SyncRunItem"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "SyncRunItem";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "SyncRunItem"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "SyncAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncAttempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SyncAttempt";
CREATE POLICY tenant_isolation ON "SyncAttempt"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "SyncAttempt";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "SyncAttempt"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreSyncIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreSyncIssue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreSyncIssue";
CREATE POLICY tenant_isolation ON "StoreSyncIssue"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreSyncIssue";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreSyncIssue"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreWebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreWebhookDelivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreWebhookDelivery";
CREATE POLICY tenant_isolation ON "StoreWebhookDelivery"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreWebhookDelivery";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreWebhookDelivery"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncRun" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncRunItem" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncAttempt" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreSyncIssue" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreWebhookDelivery" TO ecomate_app';
  END IF;
END $$;
