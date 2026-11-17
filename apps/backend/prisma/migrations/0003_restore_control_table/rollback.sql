-- Rollback for 0003_restore_control_table.
--
-- WARNING: dropping the journal deletes the record of any restore currently
-- in flight. Only roll back when no backup or restore is running (check the
-- backup queue and the table contents first). After rollback, backups fail
-- with 42P01 again until the migration is re-applied — that is the
-- pre-existing behaviour this migration fixed.

DROP TABLE IF EXISTS "ecomate_control"."backup_restore_operation";
DROP SCHEMA IF EXISTS "ecomate_control";
