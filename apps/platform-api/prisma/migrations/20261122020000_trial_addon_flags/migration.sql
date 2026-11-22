-- Trial-end behaviour (Boss 2026-11-22): never silently bill a trial
-- add-on. DDL ONLY — no DML. The backfill lives in
-- 20261122020100_trial_addon_backfill.
--
-- SubscriptionAddOn.trialGranted: true when the row was attached by the
-- trial attach (provisioning). A trial-granted row is never billed until
-- confirmed (confirmedAt set by the tenant's conversion review or an
-- operator confirm). It still grants its features while attached — the
-- registry is untouched — so the shop never breaks during trial/grace.
-- PlanChangeRequest.requestedAddOnIds: the add-on ids the tenant chose
-- to KEEP in the conversion review; apply() confirms them and ends the
-- dropped trial add-ons. Prisma has no nullable list, so the no-choice
-- state is carried by addOnChoiceMade (false = no choice, apply()
-- leaves trial add-ons untouched; true + [] = keep none). The list
-- column is therefore NOT NULL DEFAULT [] — a NULL here is impossible
-- by design, and the flag (not the list) is the source of truth.
-- No new index: every new query filters by subscriptionId (covered by
-- the (subscriptionId, addOnId) unique index) or by id/tenantId.
ALTER TABLE "SubscriptionAddOn" ADD COLUMN "trialGranted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionAddOn" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "PlanChangeRequest" ADD COLUMN "requestedAddOnIds" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE "PlanChangeRequest" ADD COLUMN "addOnChoiceMade" BOOLEAN NOT NULL DEFAULT false;
