-- Trial-end behaviour backfill (Boss 2026-11-22). DATA ONLY — no DDL.
--
-- Every live add-on row on a trial-plan subscription was attached by
-- the trial attach (provisioning only ever attaches trial add-ons on
-- the trial plan), so mark it trialGranted + unconfirmed: the rows keep
-- granting their features, and billing stops until the tenant confirms
-- them at conversion (or an operator confirms them from the console).
-- Guarded by trialGranted = false so a re-run never overwrites a
-- confirmation an operator already recorded.
--
-- Operator-attached rows on trial-plan tenants get the same flag — the
-- safe direction for billing (they were attached during a trial, and
-- nothing distinguishes them retroactively). The operator can confirm
-- them from the console in one click.
--
-- Already-issued invoices are deliberately NOT rewritten: an OPEN
-- invoice that already includes trial add-on lines stands (billing
-- integrity); the operator voids it and lets the tenant convert cleanly.
UPDATE "SubscriptionAddOn" SET "trialGranted" = true
WHERE "trialGranted" = false
  AND "endedAt" IS NULL
  AND "subscriptionId" IN (
    SELECT s."id" FROM "Subscription" s
    JOIN "PlanVersion" pv ON pv."id" = s."planVersionId"
    JOIN "Plan" p ON p."id" = pv."planId"
    WHERE p."slug" = 'trial'
  );
