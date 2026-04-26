# Accounting + Analytics Finance Plan (Delivered-Only Revenue, Courier Receivable)

## Objectives
- Recognize revenue only when orders are Delivered.
- Compute profit/loss from:
  - profit = deliveredRevenue + returnFeeRevenue - COGS - courierExpense - operatingExpenses
  - courierExpense applies for Delivered and direct Returned (non-split).
- Use courier config (zone-based) for delivery + COD charges (always).
- Align Analytics and Accounting using a single finance source.

## Core Definitions
- subtotal = sum(item.price * item.quantity)
- total = subtotal + shipping - discount
- grossBeforeDiscount = total + discount (for analytics only)
- paidAmount = advance collected by us (manual/prepaid)
- shippingPaid = whether shipping was collected in advance
- shippingPaidAmount = shipping if shippingPaid is true, else 0
- due = max(total - paidAmount - shippingPaidAmount, 0)
- actualCodAmount:
  - Delivered: due (courier only collects due, not full total)
  - Returned: paidAmount (return fee) or 0

## Required Accounts
- Cash (Asset)
- Customer Advance / Unearned Revenue (Liability) **NEW**
- Courier Receivable (Asset) **NEW**
- Courier Payable (Liability) **NEW**
- Sales Revenue (Revenue)
- Sales Return / Allowance (Contra-Revenue) **NEW**
- Return Fee Revenue (Revenue) **NEW**
- Inventory (Asset)
- COGS (Expense)
- Courier Expense (Expense) **NEW**

## Finance Source of Truth
### Option A (recommended)
Create `OrderFinancialSnapshot` (1 per order):
- orderId (unique)
- businessId
- statusAtSnapshot (Delivered/Returned)
- revenue
- cogs
- courierExpense
- courierReceivable
- courierPayable
- cashReceived
- returnFeeRevenue
- netProfit
- computedAt

Analytics + Accounting read from this snapshot to avoid duplication.

## Expense Module Alignment (Accounting-Ready)
### Data model changes
- Add to Expense:
  - paidFromAccountId (Account id) **required when isPaid = true**
  - isPaid (boolean, default true)
  - paidAt (DateTime, optional)
  - payableAccountId (Account id, optional; only if isPaid = false)
- Optional: map ExpenseCategory to account:
  - expenseAccountId on ExpenseCategory for direct ledger mapping
  - fallback to current rule (ad = marketing, name contains "salary" = salary, else operating)

### Ledger rules for expenses
- If isPaid:
  - Dr Expense Account (category-mapped)
  - Cr paidFromAccountId (cash/bank/wallet)
- If not paid:
  - Dr Expense Account (category-mapped)
  - Cr Expense Payable (liability)
- When payable is settled:
  - Dr Expense Payable
  - Cr payment account (cash/bank/wallet)

### UI/UX adjustments (expenses page)
- Add "Paid from" account selector (default Cash).
- Add "Mark as paid" toggle:
  - If unchecked, show "Payable account" selector and optional due date.
  - If checked, require paidFromAccountId.
- Keep Ad Expense platform requirement.

### Analytics alignment
- Expenses total should include:
  - Expense module entries (paid or payable)
  - Staff payments (salary/commission payouts)
- Optionally show a breakdown: Paid vs Payable for accounting dashboard.

## Staff Payments Alignment (Accounting-Ready)
- Staff payment = cash outflow (salary/commission) and must hit ledger.
- Add to StaffPayment:
  - paidFromAccountId (Account id) **required**
  - paidAt (DateTime)
- Ledger entry on staff payment:
  - Dr Salary Expense (or Commission Expense if separated)
  - Cr paidFromAccountId (cash/bank/wallet)
- If commission is accrued but not yet paid:
  - Keep as staff due only (no ledger) unless you introduce Staff Payable.
- Analytics expenses must include staff payments (salary + commission payouts).

## Purchase Module Alignment (Accounting-Ready)
- Each purchase payment posts:
  - Dr Inventory (asset)
  - Cr payment account (cash/bank/wallet)
- If payment is by check, use check date for ledger timing.
- Partial payments post multiple ledger entries.
- Optional (if needed later): record Accounts Payable when inventory is received but payment not made.
 - Data model update:
   - Add paidFromAccountId to PurchasePayment (required)
   - Add paymentMethod (cash/check/bank/wallet) if needed for reporting

## Courier Charge Logic
Use courier config zone-based rates (no actual charge overrides):
- courierDeliveryCharge = rateConfig charge by zone bucket
- actualCodAmount:
  - Delivered: due (courier only collects due, not full total)
  - Returned: paidAmount (return fee) or 0
- courierCodCharge = rateConfig.codChargePercent * actualCodAmount
- courierExpense = courierDeliveryCharge + courierCodCharge
- courierReceivable = max(due - courierExpense, 0)
- courierPayable = max(courierExpense - due, 0)

Return:
- due is treated as 0 (courier does not collect)
- courierDeliveryCharge still applies
- courierCodCharge applies on paidAmount (if any)
- courierPayable captures any shortfall (always the full courierExpense in returns)
 - Split return child: courierExpense = 0, courierReceivable = 0, courierPayable = 0

## Ledger Posting Rules
### Advance collected before delivery (manual/prepaid)
- Dr Cash: paidAmount (advance)
- Cr Customer Advance / Unearned Revenue: paidAmount
> This records cash immediately without recognizing revenue before Delivered.

### Shipping paid before delivery (optional)
- If shippingPaidAmount > 0:
  - Dr Cash/Bank/Wallet (selected account): shippingPaidAmount
  - Cr Customer Advance / Unearned Revenue: shippingPaidAmount
> Shipping collected in advance reduces due at delivery.

### Delivered (single order)
Revenue recognition:
- Dr Customer Advance / Unearned Revenue: paidAmount (release advance)
- Dr Courier Expense: courierDeliveryCharge + courierCodCharge
- Dr Courier Receivable: max(due - courierExpense, 0)
- Cr Courier Payable: max(courierExpense - due, 0)
- Cr Sales Revenue: total

COGS:
- Dr COGS: sum(lot.unitCost * lot.qty)
- Cr Inventory: same amount

### Returned (single order)
Revenue reversal:
- Dr Sales Return / Allowance: total (or returned portion total)
- Cr Sales Revenue: total (or returned portion total)

COGS reversal (inventory back-in):
- Dr Inventory: original COGS (from allocations)
- Cr COGS: original COGS

Return fee (if paidAmount > 0):
- Dr Customer Advance / Unearned Revenue: paidAmount (release advance)
- Dr Courier Expense: courierDeliveryCharge + courierCodCharge
- Cr Return Fee Revenue: paidAmount
- Cr Courier Payable: courierExpense

If paidAmount == 0:
- Dr Courier Expense: courierExpense
- Cr Courier Payable: courierExpense

Split return child (no extra courier cost):
- Do NOT post courierExpense / courierPayable.
- Only reverse revenue + COGS; return fee revenue only if paidAmount is explicitly recorded.

> If an order had advance payment and later gets Returned, the advance must be handled explicitly:
> - If refunded: Dr Customer Advance, Cr Cash/Bank/Wallet (selected account)
> - If kept as return fee: treat as Return Fee Revenue and do NOT leave it in Customer Advance.

### Refund action (manual)
- Add a Refund action in Order Details (only if paidAmount > 0).
- User enters refund amount + selects refund account.
- Ledger:
  - Dr Customer Advance / Unearned Revenue: refundAmount
  - Cr Cash/Bank/Wallet: refundAmount
- Update order.paidAmount -= refundAmount and log the action.

### Courier Payment Settlement
When a courier payment entry is created (courier module):
- Dr Cash (payment amount)
- Cr Courier Receivable (payment amount)

This reconciles pending receivables.

## COGS Source (FIFO/Weighted via Lots)
1) Extend stock allocation to capture unit cost:
   - Include unitCost + totalCost in allocations from InventoryItem.unitCost.
2) Persist allocations to DB:
   - `OrderStockAllocation`:
     - orderId, inventoryItemId, productId, variantId
     - quantity, unitCost, totalCost
     - action: 'deduct' | 'restore'
3) Compute COGS for Delivered using stored allocations.
4) For Returned, reverse COGS using the same allocations (or restore allocations).

## Partial Return / Split Order
If a split return order is created:
- Child order carries returned items + totals.
- Apply Returned logic on child order, **but do not add courierExpense** (no extra courier cost on split returns).
- Parent order remains Delivered for the kept portion.
- Snapshot + ledger for each order based on its final status.

## Business Scoping
Snapshots and ledger entries should store businessId.
Manual journal entries should include businessId for accurate per-business reporting.

## Analytics Alignment
Replace direct order/expense math with snapshot aggregates:
- Revenue = sum(snapshot.revenue)
- Gross Revenue (GOV) = sum(order.total for non-canceled orders)
- Gross Before Discount = sum(order.total + discount)
- COGS = sum(snapshot.cogs)
- Courier Expense = sum(snapshot.courierExpense)
- Operating Expenses = (Expense module total + Staff payments total)
- Return Fee Revenue = sum(snapshot.returnFeeRevenue)
- Net Profit = sum(snapshot.netProfit)
  - snapshot.netProfit = revenue + returnFeeRevenue - cogs - courierExpense - operatingExpenses

## Event Triggers
Recompute snapshot + post ledger entries when:
- Status changes to Delivered or Returned
- Paid amount changes (affects actualCodAmount / courier receivable)
- Shipping address / courier changes (affects courier charge)
- Partial return split created

Ensure idempotency (do not double-post).

## Validation + Tests
- Delivered with advance payment:
  - Cash + Courier Receivable + Courier Expense == Sales Revenue
  - Profit matches analytics
- Returned with paidAmount:
  - Return Fee Revenue - Courier Expense == net
  - Inventory restored + COGS reversed
- Returned with no paidAmount:
  - Courier Expense only (loss)
- Courier payment reduces receivable correctly
- Partial return creates two snapshots with correct totals

## Risk Mitigations (Required Policies)
- Split return allocations must carry explicit allocatedSubtotal/allocatedShipping/allocatedDiscount on the child order to avoid drift.
- Advance handling for split returns:
  - Keep parent paidAmount intact; child paidAmount defaults to 0.
  - Only record return fee if explicitly captured on the child.
- Courier payment entry must include "Received To" account (Cash/Bank/Wallet), and post to that account.
- Courier payable settlement:
  - When courierPayable exists, pay via Dr Courier Payable, Cr Cash/Bank.
- Snapshot idempotency:
  - Use snapshot version/hash and ledger links to avoid double-posting.
  - If recompute changes values, reverse prior ledger and post new entries in a single transaction.
- COD charge source:
  - Apply COD charge only on amounts collected by courier (due or return fee).
  - If return fee is merchant-collected, COD charge = 0.
- Missing COGS allocations:
  - Use weighted average lot cost fallback and flag cogsEstimated=true.
- Cancelled/failed orders:
  - If stock was deducted, reverse Inventory/COGS on cancel/fail.
  - If stock was only reserved (not deducted), do not post Inventory/COGS reversals.
- Damaged status:
  - If order is marked Damaged without Returned, no inventory restore; treat COGS + courierExpense as loss.
  - If Returned is edited and only a subset is Damaged, restore inventory for the non-damaged portion only.
- Paid amount capture:
  - On first set or increase of paidAmount, require account selection and post entry immediately.
  - On decrease, require account selection and post refund entry immediately.
- Shipping paid flag:
  - If shippingPaid is checked, treat shippingPaidAmount as advance (posted to Customer Advance).
  - shippingPaid reduces due and can be retained as Return Fee Revenue when returns occur.
