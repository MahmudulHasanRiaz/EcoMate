# Orders + WooCommerce Module Action Plan

## Scope
- Orders core (list, detail, create, update, status, logs)
- Split/Exchange/Return flows
- Scan flow
- Courier dispatch/sync/import
- Orders API auth/permission and error handling
- Orders logs and user attribution
- Orders performance (list payload, pagination, indexes)
- WooCommerce integration (webhook, import, status sync, stock sync)

## Phase 0 - Baseline Snapshot (no code changes)
1) Capture current behavior for these routes:
   - Orders list/detail/summary/bulk/status/dispatch/import/scan
   - Woo webhook receive + on-hold push
2) Record minimum repro steps for known issues.
3) Save expected behaviors for status transitions and stock changes.

## Phase 1 - Blockers (critical, Orders)
1) Split API broken
   - Fix undefined variables in `src/app/api/orders/split/route.ts`.
   - Align UI response contract (parent/child) with API response.
2) Missing auth/permission on Orders APIs
   - Ensure `enforcePermission` or `getStaffAuthDetails` on:
     - `/api/orders/incomplete`
     - `/api/orders/summary`
     - `/api/orders/bulk`
     - `/api/orders/dispatch/*`
     - `/api/orders/pathao/sync`
     - `/api/orders/import/woo`
   - Standardize unauthorized JSON response.
3) API route hygiene
   - Remove stray `use server` or invalid exports from API routes.
   - Ensure `runtime`/`dynamic` exports are used only where allowed.

## Phase 2 - Data Integrity + Audit (Orders)
1) Logs should include staff name
   - Include `staff` relation when fetching logs.
   - Display priority: `staff.name` -> `log.user` -> `System`.
   - Re-enable `userId` when saving logs in order updates.
2) Diff text cleanup
   - Replace odd delimiter in `generateOrderDiff` with a readable marker.
   - Update UI parsing to match.
3) Status validation alignment
   - Confirm `orderStatusSchema` includes all valid statuses.
   - Normalize UI status names to server enum.
   - Fix partial `shippingAddress` merge vs schema validation.
4) Phone normalization consistency
   - Keep last 11 digits if starts with 0.
   - Apply same normalization for search + filters.
5) Stock movement correctness
   - Ensure stock moves to the correct product/variant and location.
   - Prevent negative stock and handle combo/variant rollups correctly.
6) Order list sort consistency
   - Final sort order: `createdAt DESC` everywhere (list, export, scan).
   - Apply same sorting across list, export, and scan results.

## Phase 3 - WooCommerce Integration Correctness (critical)
1) Webhook identity and integration mapping
   - Do not rely on `x-wc-webhook-source` only.
   - Ensure integration ID is encoded in webhook URL or signature mapping.
   - Use a per-integration secret; never default to a shared secret.
   - Align order source tag consistently (avoid `woo-${id}` vs `woo-${storeId}` mismatch).
2) Webhook update rules
   - If order already exists locally: do not update local fields.
   - Only push Woo on-hold when local already exists (idempotent).
3) Webhook SKU matching
   - If a line item has no SKU, do not force order status to New.
   - Track missing SKU lines separately and surface to staff.
4) On-hold push for webhook imports
   - If order imported via webhook, still push Woo status to on-hold.
   - Make this idempotent and log failures.
5) Shipping address normalization
   - Normalize Woo billing/shipping to internal schema early.
6) Status sync mapping
   - Expand sync to RTS/Shipped/Delivered if required by business rules.
7) SKU matching strategy
   - Avoid weak prefix matching when multiple products share prefixes.
   - Document and enforce a clear matching rule.
8) Customer note mapping
   - Map Woo customer note to internal customer note field consistently.
9) Processing fallback reconciliation
   - Periodic job (every 1 hour): fetch processing orders.
   - If local exists -> push on-hold; if missing -> import.
10) Stock status sync rules
   - Push in-stock/out-of-stock by SKU only (no quantity).
   - 12-hour audit job to reconcile stock status across sites.

## Phase 4 - Error Handling + Resilience
1) Persist webhook failures
   - Store payload + error for retry/manual review.
2) Notify on push-hold failures
   - Add admin-visible notification or log entry.
3) Standardize error response structure
   - Ensure all Orders/Woo endpoints return consistent JSON shape.
4) SSR base URL safety
   - Avoid invalid URL construction in server contexts.

## Phase 5 - Performance + Scalability
1) Orders list payload reduction
   - Remove deep includes (variants/comboItems) from list endpoint.
2) Pagination consistency
   - Cursor-based paging for large lists; ensure stable sort.
3) Index review
   - Add/verify indexes for `orderNumber`, `orderDay`, `orderSerial`,
     `customerPhone`, `status`, `createdAt`.
4) Woo import efficiency
   - Avoid per-order full product map fetch.
   - Batch SKU lookups and cache per integration.
5) Stock sync scale
   - Avoid per-request in-memory caches only (multi-instance risk).
   - Add batch size and backoff strategy.

## Phase 6 - UX + Operations
1) Orders list states
   - Separate loading, empty, and error messages.
2) Status change confirmations
   - Confirm before bulk or sensitive status changes.
3) Scan flow
   - Clear error messages and retry controls.
4) Courier dispatch
   - Idempotent dispatch and partial failure reporting.

## Verification Checklist
1) Split: parent/child creation + logs
2) Status transitions: New -> Confirmed -> RTS -> Shipped -> Delivered
3) Hold/PackingHold transitions and stock movement
4) Return flow: Return Pending -> Returned/Canceled
5) Courier dispatch: success + retry + cancel paths
6) Woo webhook import -> local order -> Woo on-hold push
7) Woo manual import (processing status only)
8) Search filters (phone/order ID) and date ranges
9) Scan flow with invalid and valid codes
10) Woo processing fallback job (import vs on-hold push)
11) Stock status push (out-of-stock + back in stock)

## Deliverables
- Code fixes across Orders + Woo modules
- Updated plan with exact changes made
- Manual QA checklist run results

## Implementation Plan (order of work)
1) Phase 1 blockers (split + permissions)
2) Phase 2 data integrity (logs, status normalization, phone)
3) Phase 3 Woo integration correctness
4) Phase 4 error handling resilience
5) Phase 5 performance improvements
6) Phase 6 UX polish + final QA
