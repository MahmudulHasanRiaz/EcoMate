-- Central Commerce (Phase 9) — P3 distribution & ownership.
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
CREATE TABLE "ProductStoreAssignment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "StoreAssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreAvailabilityRule" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "inheritFromParent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductStoreFieldState" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ownership" "FieldOwnership" NOT NULL DEFAULT 'ECOMATE',
    "baselineHash" TEXT,
    "externalHash" TEXT,
    "ecoMateHashAtRebase" TEXT,
    "evidence" "OwnershipEvidence",
    "lastPushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStoreFieldState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductStoreAssignment_tenant_id_storeId_idx" ON "ProductStoreAssignment"("tenant_id", "storeId");

-- CreateIndex
CREATE INDEX "ProductStoreAssignment_tenant_id_productId_idx" ON "ProductStoreAssignment"("tenant_id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStoreAssignment_storeId_productId_key" ON "ProductStoreAssignment"("storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreAvailabilityRule_tenant_id_storeId_idx" ON "StoreAvailabilityRule"("tenant_id", "storeId");

-- CreateIndex
CREATE INDEX "StoreAvailabilityRule_tenant_id_categoryId_idx" ON "StoreAvailabilityRule"("tenant_id", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreAvailabilityRule_storeId_categoryId_key" ON "StoreAvailabilityRule"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "ProductStoreFieldState_tenant_id_storeId_productId_idx" ON "ProductStoreFieldState"("tenant_id", "storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStoreFieldState_storeId_productId_field_key" ON "ProductStoreFieldState"("storeId", "productId", "field");

-- AddForeignKey
ALTER TABLE "ProductStoreAssignment" ADD CONSTRAINT "ProductStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreAssignment" ADD CONSTRAINT "ProductStoreAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreAvailabilityRule" ADD CONSTRAINT "StoreAvailabilityRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreAvailabilityRule" ADD CONSTRAINT "StoreAvailabilityRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreFieldState" ADD CONSTRAINT "ProductStoreFieldState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreFieldState" ADD CONSTRAINT "ProductStoreFieldState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "ProductStoreAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStoreAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductStoreAssignment";
CREATE POLICY tenant_isolation ON "ProductStoreAssignment"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "ProductStoreAssignment";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "ProductStoreAssignment"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreAvailabilityRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreAvailabilityRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreAvailabilityRule";
CREATE POLICY tenant_isolation ON "StoreAvailabilityRule"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreAvailabilityRule";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreAvailabilityRule"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "ProductStoreFieldState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStoreFieldState" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductStoreFieldState";
CREATE POLICY tenant_isolation ON "ProductStoreFieldState"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "ProductStoreFieldState";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "ProductStoreFieldState"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ProductStoreAssignment" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreAvailabilityRule" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ProductStoreFieldState" TO ecomate_app';
  END IF;
END $$;
