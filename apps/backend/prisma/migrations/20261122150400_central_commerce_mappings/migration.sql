-- Central Commerce (Phase 9) — P4/P6 external-identity mappings.
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
CREATE TABLE "StoreProductMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "lastEvaluatedVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreVariantMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "lastEvaluatedVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreVariantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCategoryMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "externalTermId" TEXT NOT NULL,
    "externalPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSkuMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSkuMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMediaMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreMediaMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrderMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lastExternalStatus" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastPushedStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrderStatusMap" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalStatus" TEXT NOT NULL,
    "internalStatusName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrderStatusMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreProductMapping_tenant_id_storeId_externalId_idx" ON "StoreProductMapping"("tenant_id", "storeId", "externalId");

-- CreateIndex
CREATE INDEX "StoreProductMapping_tenant_id_productId_idx" ON "StoreProductMapping"("tenant_id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProductMapping_storeId_productId_key" ON "StoreProductMapping"("storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreVariantMapping_tenant_id_storeId_productId_idx" ON "StoreVariantMapping"("tenant_id", "storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreVariantMapping_tenant_id_productId_idx" ON "StoreVariantMapping"("tenant_id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreVariantMapping_storeId_variantId_key" ON "StoreVariantMapping"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "StoreCategoryMapping_tenant_id_storeId_externalTermId_idx" ON "StoreCategoryMapping"("tenant_id", "storeId", "externalTermId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCategoryMapping_storeId_categoryId_key" ON "StoreCategoryMapping"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "StoreSkuMapping_tenant_id_productId_idx" ON "StoreSkuMapping"("tenant_id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSkuMapping_storeId_sku_key" ON "StoreSkuMapping"("storeId", "sku");

-- CreateIndex
CREATE INDEX "StoreMediaMapping_tenant_id_storeId_idx" ON "StoreMediaMapping"("tenant_id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMediaMapping_storeId_mediaKey_key" ON "StoreMediaMapping"("storeId", "mediaKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderMapping_orderId_key" ON "StoreOrderMapping"("orderId");

-- CreateIndex
CREATE INDEX "StoreOrderMapping_tenant_id_storeId_idx" ON "StoreOrderMapping"("tenant_id", "storeId");

-- CreateIndex
CREATE INDEX "StoreOrderMapping_tenant_id_orderId_idx" ON "StoreOrderMapping"("tenant_id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderMapping_storeId_externalOrderId_key" ON "StoreOrderMapping"("storeId", "externalOrderId");

-- CreateIndex
CREATE INDEX "StoreOrderStatusMap_tenant_id_storeId_idx" ON "StoreOrderStatusMap"("tenant_id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderStatusMap_storeId_externalStatus_key" ON "StoreOrderStatusMap"("storeId", "externalStatus");

-- AddForeignKey
ALTER TABLE "StoreProductMapping" ADD CONSTRAINT "StoreProductMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreVariantMapping" ADD CONSTRAINT "StoreVariantMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCategoryMapping" ADD CONSTRAINT "StoreCategoryMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSkuMapping" ADD CONSTRAINT "StoreSkuMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMediaMapping" ADD CONSTRAINT "StoreMediaMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderMapping" ADD CONSTRAINT "StoreOrderMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderMapping" ADD CONSTRAINT "StoreOrderMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderStatusMap" ADD CONSTRAINT "StoreOrderStatusMap_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreProductMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreProductMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreProductMapping";
CREATE POLICY tenant_isolation ON "StoreProductMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreProductMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreProductMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreVariantMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreVariantMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreVariantMapping";
CREATE POLICY tenant_isolation ON "StoreVariantMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreVariantMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreVariantMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreCategoryMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreCategoryMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreCategoryMapping";
CREATE POLICY tenant_isolation ON "StoreCategoryMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreCategoryMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreCategoryMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreSkuMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreSkuMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreSkuMapping";
CREATE POLICY tenant_isolation ON "StoreSkuMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreSkuMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreSkuMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreMediaMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreMediaMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreMediaMapping";
CREATE POLICY tenant_isolation ON "StoreMediaMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreMediaMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreMediaMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreOrderMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreOrderMapping" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreOrderMapping";
CREATE POLICY tenant_isolation ON "StoreOrderMapping"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreOrderMapping";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreOrderMapping"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreOrderStatusMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreOrderStatusMap" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreOrderStatusMap";
CREATE POLICY tenant_isolation ON "StoreOrderStatusMap"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreOrderStatusMap";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreOrderStatusMap"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreProductMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreVariantMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreCategoryMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreSkuMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreMediaMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreOrderMapping" TO ecomate_app';
  END IF;
END $$;

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreOrderStatusMap" TO ecomate_app';
  END IF;
END $$;
