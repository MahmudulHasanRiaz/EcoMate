# Accounting + Finance Implementation Plan

## Phase 0 - Prep and Safety
- Create a feature branch or stash (optional) so we can revert safely if needed.
- Record current DB backup method (no destructive changes).
- Confirm default Chart of Accounts naming (Cash/Accounts Receivable/Inventory/etc).

## Phase 1 - Schema and Migrations (Non-destructive)
### 1.1 New/updated models
- Order
  - shippingPaid (Boolean, default false)
  - shippingPaidAmount (Float, default 0)
  - Optional (if not present): shippingPaidAccountId (String, nullable, Account FK)
- Expense
  - isPaid (Boolean, default true)
  - paidFromAccountId (String, nullable, Account FK)
  - paidAt (DateTime, nullable)
  - payableAccountId (String, nullable, Account FK)
- StaffPayment
  - paidFromAccountId (String, nullable, Account FK)
  - paidAt (DateTime, nullable)
- PurchasePayment
  - paidFromAccountId (String, nullable, Account FK)
  - paymentMethod (String/enum if needed)
- ExpenseCategory (optional)
  - expenseAccountId (String, nullable, Account FK)
- New: OrderFinancialSnapshot
  - orderId (unique), businessId, statusAtSnapshot
  - revenue, cogs, courierExpense, courierReceivable, courierPayable
  - cashReceived, returnFeeRevenue, netProfit, computedAt
  - cogsEstimated (Boolean, default false)
- New: OrderStockAllocation (for COGS)
  - orderId, inventoryItemId, productId, variantId
  - quantity, unitCost, totalCost, action (deduct/restore)
 - New: OrderPaymentEvent (for paidAmount/shippingPaid/refund events)
  - orderId, businessId
  - eventType (AdvanceReceived | ShippingPaid | Refund)
  - amount, accountId, createdAt
- Split return allocation fields (child order):
  - allocatedSubtotal, allocatedShipping, allocatedDiscount
  - ensure they exist on split child order or a dedicated allocation table

### 1.2 Migration strategy
- Add columns as nullable with defaults (no data loss).
- Backfill later via a script (Phase 6).
- Do not drop or rename existing fields.
- Verify LedgerEntry has businessId; add if missing.

## Phase 2 - Chart of Accounts + Ledger Extensions
### 2.1 Default accounts
- Ensure defaults include:
  - Salary Expense (includes commission)
  - Operating Expense (for Expense module)
  - Customer Advance / Unearned Revenue
  - Courier Receivable
  - Courier Payable
  - Sales Return / Allowance
  - Return Fee Revenue
  - Courier Expense

### 2.2 Ledger idempotency
- Add snapshotId or postingGroup to LedgerEntry (optional but recommended).
- Enforce idempotency by refusing to post twice for the same snapshotId/postingGroup.
- When recompute changes values: reverse old ledger entries then post new ones (single transaction).
- Record advance/refund/shipping-paid cash postings from OrderPaymentEvent (not snapshot recompute).
- Add Courier Payable settlement flow (Dr Courier Payable, Cr Cash/Bank) for explicit payouts.

## Phase 3 - Order Flow + Snapshot Engine
### 3.1 Snapshot computation service
- Build computeOrderSnapshot(orderId):
  - Uses delivered/returned status only.
  - Uses shippingPaidAmount and paidAmount to compute due.
  - Computes courierExpense/receivable/payable by courier config.
  - Uses OrderStockAllocation for COGS (fallback to weighted avg + cogsEstimated flag).
  - COD charge applies only on due amount; if due = 0, COD charge = 0.
  - COD charge never applies to full total.

### 3.2 Posting rules
- Delivered:
  - Release advance (Customer Advance -> Revenue)
  - Courier Expense, Courier Receivable/Payable
  - COGS
- Returned:
  - Reverse revenue + COGS
  - Apply return fee revenue if paidAmount retained
  - If shippingPaidAmount was collected and not refunded, include it in returnFeeRevenue and release from Customer Advance
  - Courier expense always (non-split), payable if due short
- Split return child:
  - courierExpense = 0
  - only revenue/COGS reversal for returned portion
  - child paidAmount defaults to 0; only apply return fee if explicitly captured on child
  - parent order remains Delivered for the kept portion
 - Cancelled/failed:
   - If stock deducted: reverse Inventory/COGS
   - If only reserved: no Inventory/COGS posting
 - Damaged:
   - No inventory restore; treat COGS + courierExpense as loss
   - If partial damaged after return edit, restore only non-damaged portion

### 3.3 Triggers
- On status change to Delivered/Returned.
- On paidAmount change.
- On shippingPaid change.
- On courier/zone/address change.
- On split return creation.
- On cancel/damaged transitions (for reversal or loss rules).

## Phase 4 - UI + API Updates
### 4.1 Orders
- Order create/edit:
  - Paid amount requires account selection.
  - Shipping Paid toggle + paid-from account selection.
  - If paidAmount increases, post OrderPaymentEvent (AdvanceReceived) immediately.
  - If paidAmount decreases, post OrderPaymentEvent (Refund) immediately.
  - If shippingPaid toggled on, post OrderPaymentEvent (ShippingPaid) immediately.
- Refund action in Order Details:
  - Input refund amount + select account.
  - Updates order.paidAmount and posts ledger.
 - Shipping paid amount:
   - If enabled, post OrderPaymentEvent with accountId.
 - Split return: store allocatedSubtotal/shipping/discount on child.

### 4.2 Expenses
- Add Paid/Unpaid toggle.
- Paid-from account selector.
- Payable account selector when unpaid.
- Enforce platform for ad expense (existing).
- Add "Settle payable" flow (payable -> cash/bank) with account selector.
- Apply ExpenseCategory mapping fallback rule (ad = marketing, salary in name = salary, else operating).
- Ledger rules:
  - If isPaid: Dr Expense Account, Cr paidFromAccountId
  - If not paid: Dr Expense Account, Cr Expense Payable
  - On settlement: Dr Expense Payable, Cr payment account
 - Expense Account defaults to Operating Expense unless category mapping overrides.

### 4.3 Staff payments
- Add paidFromAccountId to staff payment UI/API.
- Post ledger entry when payment recorded.
- Commission accrual remains off-ledger until payment is recorded.
 - Use Salary Expense account (salary + commission).

### 4.4 Purchases
- Add paidFromAccountId to purchase payment UI/API.
- Ledger entry: Dr Inventory, Cr paidFromAccountId.
- If payment is by check, use check date for ledger timing.
- Partial payments post multiple ledger entries.
 - Optional: Accounts Payable when inventory received but payment deferred.

### 4.5 Courier payments
- Add Received To account selector.
- Ledger entry: Dr selected account, Cr Courier Receivable.
- Add Courier Payable settlement UI if required.

## Phase 5 - Analytics Alignment
- Switch analytics summary to snapshots:
  - Revenue, COGS, Courier Expense, Return Fee Revenue, Net Profit.
- Operating Expenses = Expense module total (paid + payable) + Staff payments.
- GOV remains total of non-canceled order totals.
- Gross Before Discount output (from order.total + discount).
- Add paid vs payable expense breakdown (optional UI).

## Phase 6 - Backfill and Data Hygiene
- Backfill OrderFinancialSnapshot for historical orders (Delivered/Returned).
- Backfill OrderStockAllocation if possible; else mark cogsEstimated.
- Backfill shippingPaid/paidFromAccountId where possible:
  - Default to Cash when unknown.
- Backfill StaffPayment/PurchasePayment paidFromAccountId to Cash if missing.
- Backfill OrderPaymentEvent from existing paidAmount/shippingPaidAmount changes (best-effort).
- Backfill split return allocation fields for existing split orders.
 - Enforce businessId on snapshots and ledger entries (backfill existing).

## Phase 7 - Validation + Tests
- Delivered with paidAmount + shippingPaid: ledger balances correct.
- Returned with paidAmount retained: return fee revenue + courier expense.
- Returned with no paidAmount: courier expense only.
- Split return child: no courier expense.
- Courier payment entry clears receivable.
- Expense unpaid creates payable; paid creates cash credit.
- Staff payment appears in ledger + analytics expenses.
- Purchase payment appears in ledger + analytics inventory value.
- Cancelled/failed reversal only when stock was deducted.
- Damaged (full + partial) inventory restore rules respected.
- COD charge applies only to courier-collected amount.
- Expense category fallback mapping applied.
- Check-date ledger timing for purchase payments.
 - paidAmount/shippingPaidAmount increase posts advance immediately; decrease posts refund.
 - shippingPaidAmount retained on returns adds to returnFeeRevenue when not refunded.

## Phase 8 - Rollout
- Run migrations.
- Run backfill script.
- Verify accounting dashboard totals on real data.
- Monitor for double-posting or mismatched balances.

## Open Questions (confirm before implementation)
Resolved:
- Commission included in Salary Expense.
- Enforce unique constraint on snapshotId/postingGroup to prevent duplicates.
