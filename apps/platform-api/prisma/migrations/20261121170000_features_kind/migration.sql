-- Features page (Boss point 1, 2026-11-21): classify every catalogue
-- feature as initial vs add-on, with EN scope / without-access text for
-- the console i-button and a link to the AddOn row selling it.
-- DDL ONLY — no DML. The kind/scope/withoutAccess/category backfill
-- lives in 20261121170100_features_kind_backfill (the repo rule keeps
-- enum creation + DML using the new value in separate files).
CREATE TYPE "FeatureKind" AS ENUM ('INITIAL', 'ADD_ON');

ALTER TABLE "Feature" ADD COLUMN "kind" "FeatureKind" NOT NULL DEFAULT 'INITIAL';
ALTER TABLE "Feature" ADD COLUMN "scope" TEXT;
ALTER TABLE "Feature" ADD COLUMN "withoutAccess" TEXT;
ALTER TABLE "Feature" ADD COLUMN "addOnId" TEXT;

-- Kind filter on the Features list (kind = 'ADD_ON' / 'INITIAL').
CREATE INDEX "Feature_kind_idx" ON "Feature"("kind");

-- GIN on the plan-version features array: the detail view asks "which
-- plan versions include key X" (array-contains); a b-tree cannot serve
-- that, GIN can.
CREATE INDEX "PlanVersion_features_idx" ON "PlanVersion" USING GIN ("features");

-- AddForeignKey (delete the add-on → the feature link clears, the
-- feature row itself survives).
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
