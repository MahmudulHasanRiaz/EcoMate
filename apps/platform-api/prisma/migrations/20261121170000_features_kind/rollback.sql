-- Rollback for 20261121170000_features_kind.
-- Drops the Feature kind/scope/withoutAccess/addOnId columns (the
-- classification + i-button text + add-on links are lost; the feature
-- rows themselves survive), the kind + features-array indexes, and the
-- FeatureKind enum. Run the backfill rollback first if it was applied
-- (it only resets data on these same columns, so order does not matter
-- for correctness — this file drops the columns either way).
ALTER TABLE "Feature" DROP CONSTRAINT IF EXISTS "Feature_addOnId_fkey";
DROP INDEX IF EXISTS "PlanVersion_features_idx";
DROP INDEX IF EXISTS "Feature_kind_idx";
ALTER TABLE "Feature" DROP COLUMN IF EXISTS "addOnId";
ALTER TABLE "Feature" DROP COLUMN IF EXISTS "withoutAccess";
ALTER TABLE "Feature" DROP COLUMN IF EXISTS "scope";
ALTER TABLE "Feature" DROP COLUMN IF EXISTS "kind";
DROP TYPE IF EXISTS "FeatureKind";
