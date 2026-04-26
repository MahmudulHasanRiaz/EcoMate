SELECT tablename, indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('Order', 'LedgerEntry', 'InventoryItem', 'Expense', 'PurchasePayment', 'StaffPayment') 
ORDER BY tablename, indexname;
