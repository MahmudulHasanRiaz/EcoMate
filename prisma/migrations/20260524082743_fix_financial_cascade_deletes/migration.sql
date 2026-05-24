-- AlterTable: Prevent cascade delete from Account to LedgerEntry
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_accountId_fkey",
    ADD CONSTRAINT "LedgerEntry_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- AlterTable: Prevent cascade delete from Product to InventoryItem
ALTER TABLE "InventoryItem" DROP CONSTRAINT IF EXISTS "InventoryItem_productId_fkey",
    ADD CONSTRAINT "InventoryItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- AlterTable: Prevent cascade delete from Supplier to PurchaseOrder
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_supplierId_fkey",
    ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;
