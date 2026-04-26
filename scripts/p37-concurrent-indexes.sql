-- PRODUCTION-SAFE CONCURRENT INDEX CREATION (P37b)
-- WARNING: DO NOT RUN THIS SCRIPT INSIDE A TRANSACTION.
-- Run via psql: psql -d fashionary -f scripts/p37-concurrent-indexes.sql

-- Order search (contains/ILIKE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_customerPhone_gin_idx" ON "Order" USING GIN ("customerPhone" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_orderNumber_gin_idx" ON "Order" USING GIN ("orderNumber" gin_trgm_ops);

-- LedgerEntry filtering (Already present in Prisma schema)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LedgerEntry_accountId_date_idx" ON "LedgerEntry"("accountId", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LedgerEntry_businessId_date_idx" ON "LedgerEntry"("businessId", "date");

-- InventoryItem lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InventoryItem_productId_variantId_locationId_idx" ON "InventoryItem"("productId", "variantId", "locationId");

-- Expense filters (Already present in Prisma schema)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Expense_businessId_date_idx" ON "Expense"("businessId", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Expense_categoryId_date_idx" ON "Expense"("categoryId", "date");

-- PurchasePayment checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchasePayment_checkDate_idx" ON "PurchasePayment"("checkDate");

-- StaffPayment history
CREATE INDEX CONCURRENTLY IF NOT EXISTS "StaffPayment_staffId_createdAt_idx" ON "StaffPayment"("staffId", "createdAt");
