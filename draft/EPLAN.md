# Ops Data Reset Script (Keep Products/Staff/Partners/Settings)

## Summary
Create a one‑time reset script that **wipes all operational/financial data** (orders, customers, inventory, purchases, expenses, accounting, staff financials) while **preserving** products, staff profiles, partners, businesses, integrations, app settings, accounts list, stock locations, and images. Includes dry‑run + apply mode and clear safety guards.

## Key Changes
- **New script** `scripts/reset-ops-data.ts` (Prisma):
  - **Dry‑run by default** (prints counts).
  - **Apply mode** requires `--apply` + `--confirm=RESET_OPS_DATA`.
  - Executes deletions in safe FK order.
- **Data to delete** (per your confirmed scope):
  - **Orders & customers**: `Order`, `OrderLog`, `OrderProduct`, `OrderPaymentEvent`, `OrderFinancialSnapshot`, `OrderStockAllocation`, `CourierDispatchLog`, `OrderRestriction`, `WooCheckoutLead`, `Customer`, `CustomerAddress`.
  - **Issues**: `Issue`, `IssueLog` (delete both).
  - **Inventory**: `InventoryMovement`, `StockTransfer`, `InventoryItem`, `FabricLotUsage`.
  - **Purchases/production**: `PurchasePayment`, `PurchaseOrderLog`, `ProductionStep`, `PurchaseOrderItem`, `PurchaseOrder`.
  - **Expenses/accounting**: `Expense`, `CheckPassingItem`, `CheckPassingLog`, `LedgerEntry`, `LedgerEntrySequence`, `CourierPayment`.
  - **Staff financials**: `StaffPayment`, `StaffFine`, `StaffIncome`.
  - **Marketing**: `MarketingSpend` only (campaigns retained; attribution will be removed with order deletion).
  - **Ops logs**: `ExportJob`, `WebhookFailure`.
- **Data to keep**:
  - `Product`, `ProductVariant`, `ComboProductItem`, `Category`, `Attribute`
  - `StaffMember`, `StaffInvite` (optional keep), staff profiles intact
  - `Supplier`, `Vendor` (partners)
  - `Business`, `AppSetting`
  - `CourierIntegration`, `WooCommerceIntegration`, `WooSkuMapping`
  - `Account` (account list only)
  - `StockLocation` (warehouse list)
  - Any static config tables not listed above

## Execution Notes (Safety)
- **Stop workers / pause writes** while running to avoid new data mid‑reset.
- **Take a DB backup** before running (manual `pg_dump` or existing backup tooling).
- Run **dry‑run first**; only then run apply.

## Test Plan / Acceptance
- Dry‑run prints counts for all targeted tables, no changes.
- Apply run sets:
  - Orders = 0, Customers = 0
  - InventoryItems/Movements/Transfers = 0
  - PurchaseOrders/Items/Payments = 0
  - Expenses/LedgerEntries/CourierPayments = 0
  - StaffIncome/StaffFine/StaffPayment = 0
- Products/Variants/Images intact.
- Staff list intact.
- Partners (Supplier/Vendor) intact.
- Businesses & integrations intact.
- Accounts & stock locations intact.

## Assumptions
- You want to keep marketing **campaigns** but clear **spend** (financial reset).
- You want to clear all Issues to avoid FK blocks with order deletion.
- You want to clear Woo leads, webhook failures, export jobs.

