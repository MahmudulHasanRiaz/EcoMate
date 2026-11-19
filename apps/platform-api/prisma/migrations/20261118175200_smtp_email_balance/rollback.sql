-- Rollback for 20261118175200_smtp_email_balance.
-- Drops the four email-balance tables (and their indexes + FKs) and the
-- three enums. All email-balance state is lost: lots, ledger history,
-- top-ups and cached counters. Invoices created for top-ups are NOT
-- dropped (they are billing records) — their EmailTopUp rows go with
-- the tables, so a rolled-back top-up invoice keeps its money trail but
-- loses its email grant. Run the backfill rollback first if the backfill
-- migration was applied (it removes the seeded rows; this file then
-- drops the empty tables).
DROP TABLE IF EXISTS "EmailBalanceLedger";
DROP TABLE IF EXISTS "EmailBalanceLot";
DROP TABLE IF EXISTS "EmailTopUp";
DROP TABLE IF EXISTS "TenantEmailAccount";
DROP TYPE IF EXISTS "EmailTopUpStatus";
DROP TYPE IF EXISTS "EmailLedgerKind";
DROP TYPE IF EXISTS "EmailLotSource";
