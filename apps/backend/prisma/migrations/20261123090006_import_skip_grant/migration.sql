-- WooCommerce product import — app-role grant for StoreProductImportSkip.
--
-- Follow-up to 20261123090004_import_skip_table, which created the table
-- WITHOUT the per-table grant the Phase 9 migrations carry for every new
-- tenant table. Without it the runtime role (ecomate_app, NOSUPERUSER,
-- NOBYPASSRLS) gets `permission denied for table StoreProductImportSkip`
-- on any catalog read or skip write — found by the import E2E, which
-- failed with exactly that error until the grant was applied.
--
-- A separate migration (rather than editing 0004) because 0004 is already
-- applied: applied migrations are never edited.
--
-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreProductImportSkip" TO ecomate_app';
  END IF;
END $$;
