# Inventory + Orders + Products + Purchases Integration Plan

## Scope
- Stock reservation and deduction across multiple lots and locations (FIFO by receivedDate)
- Location priority (Godown first, then smart fallback if no default exists)
- Stock source clarity to avoid user confusion (logs + UI cues)
- Combo stock deduction uses component SKUs (variant-aware)
- Combo stock display (component-wise) wherever stock is shown
- Remove 3-piece product type from UI and app layer (treat as variable)

## Phase 1 - Stock Allocation Core (critical)
1) Add shared allocation helper
   - Location priority:
     - If any location is marked as default in system settings, use that first.
     - Else if any location name matches "Godown" (case-insensitive), use that first.
     - Else fallback to createdAt ASC.
   - FIFO: sort lots by receivedDate ASC (fallback createdAt ASC).
   - Allocate across multiple lots and locations.
2) Update stock reservation (New orders)
   - Reserve across lots using available = quantity - reservedQuantity.
   - Release reservation across lots in the same priority order.
   - Log summary (order log) so users see where stock is reserved.
3) Update stock deduction (Confirmed/Damaged)
   - Deduct across lots and locations (FIFO).
   - Record inventory movements per lot with location+lot in notes.
   - Add order log summary with lot/location breakdown.
4) Update stock restoration (Canceled/Returned)
   - Restore across lots/locations (reverse FIFO or latest lot in priority location).
   - Record inventory movements with lot/location notes.
5) Stock source clarity (avoid confusion)
   - Add a concise note in order history (and/or order details) showing:
     "Stock deducted from: {location} / {lot} (qty ...)".
   - If mixed sources, show summarized breakdown.

## Phase 2 - Order Editing + Reservation Correctness
1) If order status is New and items are edited:
   - Release previous reservations (regular + combo).
   - Re-reserve for new items (regular + combo).
2) Keep isStockReserved flags consistent.

## Phase 3 - Combo Stock Rules + UI
1) Combo stock deduction uses component SKUs (variant-aware).
2) Combo availability should be computed as the MIN of component availability.
3) Combo stock display (component-wise) in:
   - Products list inventory column.
   - Product details combo table (include component stock and variant if defined).
   - Inventory module (if combo shown, display computed min stock + component list).

## Phase 4 - Remove 3-piece Product Type (UI + Mapping)
1) Product create/edit UI:
   - Remove three_piece option.
   - Show fabric consumption inputs for variable products (optional).
2) API/services mapping:
   - Map prisma productType '3-piece' to app 'variable'.
   - When saving, use 'variable' (auto-migrate existing when edited).
   - Keep DB enum as-is for now to avoid risky migrations.

## Phase 5 - Verification
1) Reservation and deduction across multiple lots (with location priority).
2) Order edit in New status updates reservations correctly.
3) Combo order deduction for each component.
4) Combo stock UI shows per-component stock and min.
5) No three_piece option shown; fabric consumption still editable for variable.
6) Stock source clarity visible in order history/details.

## Notes
- Use receivedDate for FIFO ordering.
- Keep logs readable: include lot number and location name.
- If no default location exists, start with Godown if present, then fallback to oldest location.
