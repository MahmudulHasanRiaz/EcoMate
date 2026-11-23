-- Rollback for 20261123090006_import_skip_grant: revoke the app-role
-- grant on StoreProductImportSkip. (Rolling back 0004 drops the table,
-- which removes its privileges implicitly; this revoke covers rolling
-- back 0006 alone.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "StoreProductImportSkip" FROM ecomate_app';
  END IF;
END $$;
