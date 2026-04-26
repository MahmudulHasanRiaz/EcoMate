-- Add indexes for check passing lookups
CREATE INDEX "PurchasePayment_checkDate_checkStatus_idx" ON "PurchasePayment" ("checkDate", "checkStatus");
CREATE INDEX "StaffPayment_checkDate_checkStatus_idx" ON "StaffPayment" ("checkDate", "checkStatus");
CREATE INDEX "Expense_checkDate_checkStatus_idx" ON "Expense" ("checkDate", "checkStatus");

-- Inventory and ledger performance indexes
CREATE INDEX "InventoryItem_productId_variantId_idx" ON "InventoryItem" ("productId", "variantId");
CREATE INDEX "LedgerEntry_accountId_date_idx" ON "LedgerEntry" ("accountId", "date");
CREATE INDEX "LedgerEntry_businessId_date_idx" ON "LedgerEntry" ("businessId", "date");