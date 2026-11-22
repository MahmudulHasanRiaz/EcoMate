-- Rollback for 20261122150000_central_commerce_enums.
-- Drops the 14 central-commerce enums. Only valid while no table uses
-- them (i.e. before 20261122150100+ apply, or after those roll back).
DROP TYPE IF EXISTS "MarketingChannel";
DROP TYPE IF EXISTS "SalesChannelType";
DROP TYPE IF EXISTS "SyncIssueStatus";
DROP TYPE IF EXISTS "SyncObjectType";
DROP TYPE IF EXISTS "SyncItemStatus";
DROP TYPE IF EXISTS "SyncTriggerType";
DROP TYPE IF EXISTS "SyncRunStatus";
DROP TYPE IF EXISTS "SyncRunScope";
DROP TYPE IF EXISTS "OwnershipEvidence";
DROP TYPE IF EXISTS "FieldOwnership";
DROP TYPE IF EXISTS "StoreAssignmentSource";
DROP TYPE IF EXISTS "StoreHealthState";
DROP TYPE IF EXISTS "StoreStatus";
DROP TYPE IF EXISTS "StoreKind";
