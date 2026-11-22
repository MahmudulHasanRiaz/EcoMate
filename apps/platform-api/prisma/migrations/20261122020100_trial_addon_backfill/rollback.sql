-- Rollback for 20261122020100_trial_addon_backfill.
-- Resets the backfilled flags only: trialGranted back to false and
-- confirmedAt back to NULL for live trial-plan rows that are still
-- unconfirmed (a confirmation recorded after the backfill is kept —
-- the confirmedAt IS NULL guard protects it).
UPDATE "SubscriptionAddOn" SET "trialGranted" = false
WHERE "trialGranted" = true
  AND "confirmedAt" IS NULL
  AND "endedAt" IS NULL
  AND "subscriptionId" IN (
    SELECT s."id" FROM "Subscription" s
    JOIN "PlanVersion" pv ON pv."id" = s."planVersionId"
    JOIN "Plan" p ON p."id" = pv."planId"
    WHERE p."slug" = 'trial'
  );
