-- Pricing engine data backfill (design §12 step 2). DATA ONLY — no DDL.
-- Idempotent: guarded by the '{}' default / MANUAL kind, so a re-run is
-- safe. Existing versions become fixed-price plans (baseFee = price,
-- cycle from interval, no metering, no free months); subscription-linked
-- invoices become SUBSCRIPTION kind.

-- Backfill PlanVersion.pricing from the price/interval columns.
UPDATE "PlanVersion"
SET "pricing" = jsonb_build_object(
  'pricingVersion', 1,
  'baseFee', jsonb_build_object('amount', "price"::numeric, 'currency', "currency"),
  'billingCycle', CASE
    WHEN "interval" = 'MONTHLY' THEN 'MONTHLY'
    WHEN "interval" = 'YEARLY' THEN 'YEARLY'
    WHEN "interval" = 'CUSTOM' AND "intervalDays" = 7 THEN 'WEEKLY_7D'
    ELSE 'MONTHLY'
  END,
  'freeMonths', 0
)
WHERE "pricing" = '{}'::jsonb;

-- Existing subscription-linked invoices are subscription invoices.
UPDATE "Invoice"
SET "kind" = 'SUBSCRIPTION'
WHERE "subscriptionId" IS NOT NULL AND "kind" = 'MANUAL';
