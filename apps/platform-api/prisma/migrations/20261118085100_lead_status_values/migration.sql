-- Landing CMS Batch 1 (item 10): extend LeadStatus to the 6-status
-- workflow (NEW, CONTACTED, QUALIFIED, DEMO_SCHEDULED, WON, LOST, CLOSED).
--
-- DDL ONLY — enum ADD VALUE and any DML using the new values must never
-- share one migration (Postgres 55P04: a new enum value cannot be used in
-- the same transaction that adds it). No DML here; no existing row
-- changes status.

ALTER TYPE "LeadStatus" ADD VALUE 'QUALIFIED';
ALTER TYPE "LeadStatus" ADD VALUE 'DEMO_SCHEDULED';
ALTER TYPE "LeadStatus" ADD VALUE 'WON';
ALTER TYPE "LeadStatus" ADD VALUE 'LOST';
