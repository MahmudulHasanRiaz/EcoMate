/*
 * ============================================================================
 * PARTITIONING RUNBOOK (P28) - SQL TEMPLATES
 * ============================================================================
 * WARNING: DO NOT RUN WITHOUT MANUAL REVIEW AND TESTING IN STAGING.
 * These commands involve table renames and large data copies.
 * 
 * Target: Transitioning large tables to Native RANGE Partitioning.
 * ============================================================================
 */

-- 1. Example: Order Table Partitioning

/*
-- Step 1: Create the partitioned table
CREATE TABLE "Order_partitioned" (
    LIKE "Order" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
) PARTITION BY RANGE ("createdAt");

-- Step 2: Create initial partitions (Month by Month for 2025)
CREATE TABLE "Order_p2025_01" PARTITION OF "Order_partitioned"
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE "Order_p2025_02" PARTITION OF "Order_partitioned"
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
    
-- ... Repeat for all required months ...

-- Step 3: Backfill Data (Must be done in batches)
-- INSERT INTO "Order_partitioned" SELECT * FROM "Order" WHERE "createdAt" >= '2025-01-01' AND "createdAt" < '2025-02-01';

-- Step 4: Atomic Swap (Inside Transaction)
BEGIN;
ALTER TABLE "Order" RENAME TO "Order_legacy";
ALTER TABLE "Order_partitioned" RENAME TO "Order";
-- Important: Re-attach any Foreign Key dependencies that were broken
COMMIT;
*/

-- 2. Automation Helper Template (PL/pgSQL)
-- This function can be used to pre-create partitions for the next 12 months.

/*
CREATE OR REPLACE FUNCTION create_future_partitions(target_table TEXT, prefix TEXT) RETURNS void AS $$
DECLARE
    next_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 1..12 LOOP
        next_date := (date_trunc('month', current_date) + (i || ' month')::interval)::date;
        partition_name := prefix || '_' || to_char(next_date, 'YYYY_MM');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)', 
            partition_name, target_table, next_date, (next_date + '1 month'::interval)::date);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
*/

-- 3. Maintenance Notes:
-- - Vacuum: Auto-vacuum runs on individual partitions.
-- - Cleanup: To archive data, you can simply "DETACH PARTITION" and export/delete the sub-table.
-- - Prisma: Note that Prisma's introspect might see partitions as separate tables. 
--   Recommended to mask sub-partitions from Prisma and only show the parent.
