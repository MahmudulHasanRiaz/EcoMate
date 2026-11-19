-- Rollback for 20261119083000_plan_change_requests.
-- Drops the PlanChangeRequest table (all plan-change request state is
-- lost: pending requests disappear, decided history with them) and the
-- PlanChangeRequestStatus enum. Plan changes already APPLIED are NOT
-- undone — the tenant keeps its new plan; only the request record goes.
DROP TABLE IF EXISTS "PlanChangeRequest";
DROP TYPE IF EXISTS "PlanChangeRequestStatus";
