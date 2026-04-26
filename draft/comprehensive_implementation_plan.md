# 🚀 Comprehensive Implementation Plan

**Objective:** Finalize the enterprise features of the Fashionary system by bridging the gap between Production, Inventory, and Order performance.

---

## 🏗️ 1. Production Stock Loop (High Priority)
*Currently, the system assumes fabric is ALWAYS purchased from an external supplier.*

### [MODIFY] [prisma/schema.prisma](file:///e:/fashionary/Fashionary/prisma/schema.prisma)
- Add `fabricInventoryId String?` to `ProductionStep`.

### [MODIFY] [src/server/modules/purchases.ts](file:///e:/fashionary/Fashionary/src/server/modules/purchases.ts)
- **Logic**: Update `updateThreePieceFabricPlanningCore`.
- If `source === 'INTERNAL'`, find `InventoryItem` and call `decrementStock`.
- Ensure this is wrapped in a `prisma.$transaction`.

---

## ⚡ 2. Order Module "Fire-Speed" Optimization
*The current `client-page.tsx` is 1500+ lines and uses client-side filtering.*

### [MODIFY] [src/server/modules/orders.ts](file:///e:/fashionary/Fashionary/src/server/modules/orders.ts)
- **Update `getOrders`**:
    ```typescript
    where.createdAt = { gte: startDate, lte: endDate };
    if (assignedToId) where.assignedToId = assignedToId;
    ```

### [MODIFY] [src/app/dashboard/orders/client-page.tsx](file:///e:/fashionary/Fashionary/src/app/dashboard/orders/client-page.tsx)
- **Lazy Loading**:
  ```tsx
  const OrderDetailsDialog = dynamic(() => import("./OrderDetailsDialog"), { ssr: false });
  ```
- **State Management**: Pass filter states directly to `getOrders` service instead of local `.filter()`.

---

## 🥘 3. Combo Order Precision
### [MODIFY] [src/server/modules/orders.ts](file:///e:/fashionary/Fashionary/src/server/modules/orders.ts)
- **Logic**: In `createOrder`, if a product is a `Combo`, automatically populate the `siteDiscount` field based on the difference between `Sum(Children)` and `ComboPrice`.

---

## 🔄 4. UI Polish & UX
### [NEW] Progress Components
- Add a floating `ProgressIndicator` for:
    - WooCommerce Bulk Sync.
    - Courier Dispatch loops.
    - Large PDF Exports.

---

## 📊 4. Analytics & Financial Integrity
*Current analytics use mock data; real precision is required for enterprise scaling.*

### [MODIFY] [src/services/analytics.ts](file:///e:/fashionary/Fashionary/src/services/analytics.ts)
- **Replace Mocks**: Use Prisma `groupBy` and `sum` to calculate Revenue and COGS.
- **COGS Logic**: `orderProduct.quantity * inventoryItem.unitCost` (FIFO) or `purchaseOrderItem.unitCost`.
- **Validation**: Ensure `Gross Profit = Revenue - COGS` is verified against bank/cash ledger.

---

## 🏷️ 5. Thermal Printing & Barcode Stabilization
*Thermal printers require pixel-perfect alignment and specific page sizing.*

### [MODIFY] [src/app/print/sticker-template.tsx](file:///e:/fashionary/Fashionary/src/app/print/sticker-template.tsx)
- **Calibration**: 
    - Use `@page { size: 50mm 25mm; margin: 0; }` (or configurable).
    - Remove `rounded-md` and shadows from print view.
    - Set `image-rendering: pixelated` for barcodes to prevent blur.

---

## 📦 6. Packing Module UX (Staff-Centric)
*Packing staff need speed and mobile-friendly interactions.*

### [MODIFY] [src/app/dashboard/packing-orders/client-page.tsx](file:///e:/fashionary/Fashionary/src/app/dashboard/packing-orders/client-page.tsx)
- **Mobile UX**: 
    - Full-width product rows instead of a grid.
    - "Big Tap" buttons for status changes.
- **Scanning**: Add a global listener for HID/Bluetooth scanners to auto-confirm items.

---

## 🏗️ 1. Production Stock Loop (High Priority)
- **Error Handling**: Use `prisma.$transaction`. If stock deduction fails (e.g., Insufficient Stock), roll back the entire `ProductionStep` update and throw a specific `InsufficientStockError` to the UI.

## ⚡ 2. Order Module Optimization
- **Error Handling**: Implement "Graceful Degradation". If server-side filtering fails, default to a safe "Empty State" with a "Retry" button. Ensure the UI never freezes during fetching.

## 📊 7. Enterprise Performance & Security
- **Error Handling (API)**: 
    - Wrap all logic in `try-catch`.
    - Log errors to a central `ErrorLog` table with stack traces (excluding sensitive data).
    - **Client feedback**: Always use `toast.error()` describing exactly WHAT failed (e.g., "Network Error" vs "Permission Denied").

---

## 🛡️ Global Error Handling Standard (MANDATORY)
**For EVERY new feature, the developer MUST implement:**
1. **Input Validation**: Use `Zod` to validate ALL incoming data.
2. **Database Integrity**: Use transactions for multi-row writes.
3. **UI Feedback**: Use Skeleton loaders for pending states and clear Error Messages for failure states.
4. **Resiliency**: Implement "Fail-Open" for caching and "Fail-Closed" for security permissions.
5. **No Slips**: Every `Promise` must have a corresponding `.catch()` or `try-catch` block.
