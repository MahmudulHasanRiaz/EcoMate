# 📋 Project Execution Tasks

Values: `[ ]` Todo, `[/]` In Progress, `[x]` Done

## ✅ Phase 1: Core Foundation & Infrastructure (COMPLETED)
- [x] **1.1 Dependency Upgrade**: React 19, Next.js 15, Prisma 6.
- [x] **1.2 Clerk v6 Implementation**: Middleware and auth hooks updated.
- [x] **1.3 Type Alignment**: Fixed `StaffMember` Prisma naming conflicts.
- [x] **1.4 Recharts Stabilization**: Downgraded to 2.x for React 19 compatibility.

## 🥘 Phase 2: Combo Product Logic (PARTIALLY COMPLETED)
- [x] **2.1 Stock Movement**: Component stock is deducted upon Confirmation (FIFO).
- [ ] **2.2 Automated Discounting**: implement automated "Site Discount" calculation for combos.
- [ ] **2.3 Variant Selection Audit**: Verify and fix the UI for selecting sub-item variants in the combo builder.

## 🏭 Phase 3: Three-Piece Production (FOUNDATION READY)
- [x] **3.1 Production Stepper**: Fabric -> Printing -> Cutting workflow implemented.
- [x] **3.2 Cost Tracking**: Per-step cost and vendor tracking functional.
- [ ] **3.3 Internal Stock Integration (CRITICAL)**: 
    - [ ] Add "Source: Internal Stock" toggle in Fabric step.
    - [ ] Implement yardage deduction from `InventoryItem` when using internal stock.
- [ ] **3.4 Material Rebalancing**: Allow final adjustment of Yards vs Pieces during Receiving stage.

## ⚡ Phase 4: Order Module Hyper-Optimization (PENDING)
- [ ] **4.1 Server-Side Plumbing**:
    - [ ] **Task**: Update `getOrders` in `src/server/modules/orders.ts`.
    - [ ] **Technical Detail**: add `dateRange` (start, end) and `assignedToId` to the `Prisma.OrderWhereInput`.
    - [ ] **Error Handling**: Implement custom error boundaries for DB timeout and invalid date ranges. Return standardized 400 Errors for malformed inputs.
    - [ ] **Developer Note**: Ensure `assignedToId` correctly filters for both specific IDs and "unassigned" (null).
- [ ] **4.2 Frontend Velocity**:
    - [ ] **Task**: Optimize `src/app/dashboard/orders/client-page.tsx`.
    - [ ] **Technical Detail**: Use `next/dynamic` for large components like `OrderDetailsDialog` and `AssignDialog`.
    - [ ] **Error Handling**: Wrap dynamic components in `<ErrorBoundary />` and provide "Try Again" fallback UI. Ensure all SWR/Query calls have `onError` toast notifications.
    - [ ] **Performance Goal**: Move `.filter()` and `.sort()` logic to server-side queries. Implement `useSWR` or `TanStack Query` for cursor-based pagination.
- [ ] **4.3 UI/UX Feedback**:
    - [ ] **Task**: Build a generic `OperationProgress` component.
    - [ ] **Use Case**: Show progress (e.g., "Processing 12 of 50 orders...") for Bulk Actions and WooCommerce Sync.

## 🔄 Phase 5: External Integrations (ENHANCEMENT)
- [x] **5.1 Woo API**: `days` parameter support added to `importWooOrders`. 🥳
- [ ] **5.2 Sync UI**:
    - [ ] **Task**: Create a `SyncManager` component.
    - [ ] **Feature**: Add a dropdown for Sync Window (1, 7, 30 days) and a 'Manual Sync' button with a real-time progress bar.
    - [ ] **Error Handling**: Handle API partial failures (e.g., 5 out of 50 orders failed to sync) with a detailed "Error Log" modal for the user. Capture all Sync Exceptions in server logs.

## 🚀 Phase 6: Enterprise Performance & Scale (ROADMAPPED)
- [ ] **6.1 DB Cursor Pagination**:
    - [ ] **Instruction**: Switch `Order` and `Product` fetches to cursor-based pagination to maintain O(1) performance as data scales to 1M+ rows.
    - [ ] **Error Handling**: Ensure graceful recovery if a cursor becomes invalid (e.g., deleted item). Fallback to the first page automatically.
- [ ] **6.2 Security Audit**:
    - [ ] **Instruction**: Standardize Permission Middleware across ALL `api/` routes. Ensure `StaffRole` is validated for every sensitive write operation.
    - [ ] **Error Handling**: Log Unauthorized attempts with IP and UserID. Return clear, non-leaking "403 Forbidden" messages.
- [ ] **6.3 Caching Layer**:
    - [ ] **Instruction**: Implement Redis or memory cache for high-frequency settings reads (e.g., Courier API keys).
    - [ ] **Error Handling**: "Fail-Open" strategy: If Redis is down, query the Primary Database immediately to avoid system downtime.
