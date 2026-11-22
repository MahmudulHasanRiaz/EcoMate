-- Central Commerce (Phase 9) — P1 store foundation.
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
CREATE TABLE "Store" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "kind" "StoreKind" NOT NULL,
    "name" TEXT NOT NULL,
    "domainNormalised" TEXT,
    "identityFingerprint" TEXT,
    "providerStoreId" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING',
    "healthState" "StoreHealthState" NOT NULL DEFAULT 'DISCONNECTED',
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB DEFAULT '{}',
    "pluginVersion" TEXT,
    "capabilities" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCredential" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "keyFingerprint" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreHealthCheck" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "state" "StoreHealthState" NOT NULL,
    "reason" TEXT,
    "reachable" BOOLEAN NOT NULL DEFAULT false,
    "authenticated" BOOLEAN NOT NULL DEFAULT false,
    "permissionsOk" BOOLEAN NOT NULL DEFAULT false,
    "mediaReachable" BOOLEAN,
    "detail" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_identityFingerprint_key" ON "Store"("identityFingerprint");

-- CreateIndex
CREATE INDEX "Store_tenant_id_kind_idx" ON "Store"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "Store_tenant_id_status_idx" ON "Store"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Store_tenant_id_createdAt_idx" ON "Store"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_kind_domainNormalised_key" ON "Store"("kind", "domainNormalised");

-- CreateIndex
CREATE INDEX "StoreCredential_tenant_id_storeId_rotatedAt_idx" ON "StoreCredential"("tenant_id", "storeId", "rotatedAt");

-- CreateIndex
CREATE INDEX "StoreHealthCheck_tenant_id_storeId_checkedAt_idx" ON "StoreHealthCheck"("tenant_id", "storeId", "checkedAt");

-- CreateIndex
CREATE INDEX "StoreHealthCheck_tenant_id_checkedAt_idx" ON "StoreHealthCheck"("tenant_id", "checkedAt");

-- AddForeignKey
ALTER TABLE "StoreCredential" ADD CONSTRAINT "StoreCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreHealthCheck" ADD CONSTRAINT "StoreHealthCheck_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Store";
CREATE POLICY tenant_isolation ON "Store"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "Store";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "Store"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreCredential" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreCredential";
CREATE POLICY tenant_isolation ON "StoreCredential"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreCredential";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreCredential"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreHealthCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreHealthCheck" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreHealthCheck";
CREATE POLICY tenant_isolation ON "StoreHealthCheck"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreHealthCheck";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreHealthCheck"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "Store" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreCredential" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreHealthCheck" TO ecomate_app';
  END IF;
END $$;
