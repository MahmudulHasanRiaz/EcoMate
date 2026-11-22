-- Rollback for 20261122020000_trial_addon_flags.
-- Drops the trial-granted/confirmed flags and the requested add-on ids
-- + choice flag (the trial-end billing protection + conversion choices
-- are lost; the add-on rows and requests themselves survive). Run the
-- backfill rollback first if it was applied (it only resets data on
-- these same columns, so order does not matter for correctness — this
-- file drops the columns either way).
ALTER TABLE "PlanChangeRequest" DROP COLUMN IF EXISTS "addOnChoiceMade";
ALTER TABLE "PlanChangeRequest" DROP COLUMN IF EXISTS "requestedAddOnIds";
ALTER TABLE "SubscriptionAddOn" DROP COLUMN IF EXISTS "confirmedAt";
ALTER TABLE "SubscriptionAddOn" DROP COLUMN IF EXISTS "trialGranted";
