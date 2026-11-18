-- Rollback for 20261118133000_media_library.
-- Drops the MediaAsset table (and its indexes + FK) entirely. Media
-- rows recorded after the migration are lost; the stored FILES are
-- untouched (they live on the media volume / R2 bucket, not in the
-- database) and become orphans — delete the volume contents manually
-- if the rollback is permanent.
DROP TABLE IF EXISTS "MediaAsset";
