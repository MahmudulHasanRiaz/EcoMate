# Courier Management Module - Revised Implementation Plan

একটি সম্পূর্ণ Courier Reconciliation এবং Payment Tracking System যেখানে **per-parcel charge tracking** এবং **manual adjustment** সুবিধা থাকবে।

---

## 🎯 Core Problems & Solutions

### ❓ Problem 1: Per-Parcel COD/Delivery Charge Variation
**সমস্যা**: Config শুধু base rate রাখে, কিন্তু courier প্রতিটি parcel এ আলাদা charge করে (weight, area, negotiation অনুযায়ী)।

**✅ Solution - Hybrid Approach**:
- **Config = Baseline Only**: Default rates এর জন্য
- **Order Fields = Actual Charges**: প্রতিটি order এ manually editable actual charges
- **Auto-fill on Dispatch**: Dispatch time এ config থেকে calculate করে auto-fill
- **Manual Override**: Courier statement অনুযায়ী পরে edit করা যাবে

### ❓ Problem 2: When to Calculate Charges?
**✅ Solution - Save on Dispatch, Update Later**:
1. **Dispatch Time**: Config থেকে calculate করে Order table এ save
2. **Statement Reconciliation**: Courier statement আসার পর manually update
3. **Reporting**: সবসময় Order table এর saved values ব্যবহার (on-the-fly নয়)

### ❓ Problem 3: Return Pending Handling
**✅ Confirmed**: Return Pending parcels **Expected Payment থেকে বাদ** এবং আলাদা track হবে।

---

## 📊 Module Overview

### Menu Structure
```
📦 Courier
├── 📊 All Couriers
├── 🚚 Steadfast
├── 🚚 Carrybee
└── 🚚 Pathao
```

### Core Metrics
1. **Total Parcels**: Dispatched (excluding Return Pending)
2. **Total COD Sent**: Sum of actualCodAmount (or total)
3. **Total Charges**: Sum of (courierCodCharge + courierDeliveryCharge)
4. **Expected Payment**: COD - Charges (Return Pending বাদ)
5. **Received Payment**: Manual entries থেকে
6. **Pending Payment**: Expected - Received
7. **Return Pending**: আলাদা সেকশন (count + COD)

---

## 🗄️ Database Schema

### 1. CourierConfig (Default Rates)
```prisma
model CourierConfig {
  id                 String    @id @default(cuid())
  courierService     String    // "Steadfast", "Pathao", "Carrybee"
  businessId         String?   // null = default for all
  business           Business? @relation(fields: [businessId], references: [id])
  
  // COD Charge (baseline)
  codChargeType      String    @default("percentage")
  codChargeValue     Float     @default(0)
  
  // Delivery Charge (baseline)
  insideDhakaCharge  Float     @default(60)
  outsideDhakaCharge Float     @default(120)
  subAreaCharge      Float     @default(100)
  
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  
  @@unique([courierService, businessId])
  @@index([courierService])
}
```

### 2. CourierPayment (Manual Entries)
```prisma
model CourierPayment {
  id             String   @id @default(cuid())
  courierService String
  businessId     String
  business       Business @relation(fields: [businessId], references: [id])
  
  amount         Float
  paymentDate    DateTime
  referenceNo    String?
  note           String?
  
  createdBy      String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  
  @@index([courierService, businessId, paymentDate])
}
```

### 3. Order Model Extensions (Per-Parcel Charges)
```prisma
model Order {
  // ... existing fields
  
  // Actual COD (editable if customer paid different amount)
  actualCodAmount       Float?
  
  // Actual Charges (auto-filled on dispatch, manually editable)
  courierCodCharge      Float?   // Actual COD charge from courier
  courierDeliveryCharge Float?   // Actual delivery charge from courier
  courierNetPayable     Float?   // Auto-calculated: actualCodAmount - charges
  
  // Metadata for reconciliation
  chargesLastUpdated    DateTime?
  chargesUpdatedBy      String?
  
  @@index([courierService, status, courierDispatchedAt])
}
```

---

## 🔧 Workflows

### Workflow 1: Dispatch Time (Auto-fill)
```
1. User dispatches order to Steadfast
2. System fetches CourierConfig for (Steadfast, businessId)
3. Calculate:
   - codCharge = config.codChargeValue% of order.total
   - deliveryCharge = config.insideDhakaCharge (based on district)
   - netPayable = order.total - codCharge - deliveryCharge
4. Save to Order:
   - courierCodCharge = codCharge
   - courierDeliveryCharge = deliveryCharge
   - courierNetPayable = netPayable
```

### Workflow 2: Statement Reconciliation (Manual Update)
```
1. Courier statement arrives with actual charges
2. Admin opens "Bulk Charge Update" tool
3. Uploads CSV or manually edits per order:
   - Order #12345: COD Charge = 52 (instead of 50)
   - Order #12346: Delivery Charge = 75 (instead of 60)
4. System updates Order table and recalculates metrics
```

### Workflow 3: Payment Entry
```
1. Courier transfers payment (e.g., ৳2,40,000)
2. Admin adds CourierPayment entry:
   - Courier: Steadfast
   - Business: Panjabi Club
   - Amount: 240000
   - Date: 2025-12-20
   - Reference: Bank TXN12345
3. Dashboard updates "Received" and "Pending" metrics
```

---

## 🎨 Frontend Features

### 1. Dashboard Metrics
- Real-time calculation from Order table (not config)
- Return Pending shown separately
- Drill-down to order list

### 2. Bulk Charge Update Tool
**Purpose**: Update charges for multiple orders at once

**Features**:
- CSV Upload (orderNumber, codCharge, deliveryCharge)
- Manual grid editing
- Bulk save with validation
- Audit log

**UI**:
```
┌─────────────────────────────────────────────────┐
│ Bulk Update Courier Charges                    │
├─────────────────────────────────────────────────┤
│ [Upload CSV] or edit below:                    │
│ ┌─────────────────────────────────────────────┐│
│ │ Order    │ COD Charge │ Delivery │ Action ││
│ │ #12345   │ [52]       │ [60]     │ ✓      ││
│ │ #12346   │ [48]       │ [75]     │ ✓      ││
│ └─────────────────────────────────────────────┘│
│ [Cancel] [Save All]                            │
└─────────────────────────────────────────────────┘
```

### 3. Order Details Enhancement
প্রতিটি Order এর detail page এ:
- **Courier Charges Section** (editable by Admin/Manager):
  - COD Charge: [___] (with config-calculated default hint)
  - Delivery Charge: [___]
  - Net Payable: (auto-calculated)
  - Last Updated: 2025-12-20 by Admin User

---

## 📝 Implementation Phases

### Phase 1: Schema & Baseline
- [ ] Add `CourierConfig` and `CourierPayment` models
- [ ] Extend `Order` model with charge fields
- [ ] Run `prisma db push`
- [ ] Seed default configs for each courier

### Phase 2: Auto-calculation on Dispatch
- [ ] Update dispatch APIs (Steadfast, Pathao, Carrybee)
- [ ] Add charge calculation helper
- [ ] Save charges to Order on successful dispatch

### Phase 3: Manual Charge Management
- [ ] Create "Edit Charges" UI in Order details
- [ ] Create Bulk Update tool (CSV + Grid)
- [ ] Add validation and audit logging

### Phase 4: Metrics & Dashboard
- [ ] Create `courier-reconciliation.ts` module
- [ ] Build metrics calculation logic
- [ ] Create `/api/courier/metrics` route
- [ ] Build Courier dashboard pages

### Phase 5: Payment Tracking
- [ ] Create `CourierPayment` API
- [ ] Build "Add Payment" dialog
- [ ] Display payment history table

### Phase 6: Advanced Features
- [ ] Export to Excel
- [ ] Payment reminders
- [ ] Reconciliation reports

---

## 🎯 Key Design Decisions

### ✅ Why Store Charges in Order Table?
- **Performance**: No real-time calculation needed
- **Accuracy**: Reflects actual courier charges (not just config)
- **Auditability**: Track who changed what and when
- **Flexibility**: Easy to override per order

### ✅ Why Config Table Still Needed?
- **Baseline**: Auto-fill default values on dispatch
- **Consistency**: Standard rates across similar orders
- **Admin Control**: Centralized rate management

### ✅ Return Pending Strategy
- **Excluded from Expected Payment**: Avoid inflated expectations
- **Separate Tracking**: Clear visibility of pending returns
- **Re-include on Status Change**: If status changes to "Returned", recalculate

---

## 📊 Sample Dashboard

```
┌──────────────────────────────────────────────────────────┐
│ 🚚 Steadfast - Panjabi Club                             │
├──────────────────────────────────────────────────────────┤
│ Filters: [Business ▼] [Last 30 Days ▼] [🔄]            │
├──────────────────────────────────────────────────────────┤
│ 📦 Parcels    💰 COD Sent   💵 Charges   ✅ Expected    │
│    1,234        ৳5,43,210     ৳32,870      ৳5,10,340    │
│                                                          │
│ 💸 Received   ⏳ Pending    🔙 Return Pending           │
│    ৳4,80,000    ৳30,340       42 (৳1,23,400)            │
├──────────────────────────────────────────────────────────┤
│ Recent Payments                     [+ Add Payment]     │
│ [Table...]                          [Bulk Update]       │
├──────────────────────────────────────────────────────────┤
│ Return Pending Orders                                   │
│ [Table with actionable items...]                        │
└──────────────────────────────────────────────────────────┘
```

---

## ✅ Review Checklist

- [x] Per-parcel charge variation solved (Order table fields)
- [x] Config vs Actual charges clarified (Hybrid approach)
- [x] Charge calculation timing defined (Dispatch + Manual update)
- [x] Return Pending handling confirmed (Excluded from Expected)
- [x] Manual override capability (Bulk Update + Individual edit)
- [x] Audit trail included (chargesLastUpdated, chargesUpdatedBy)
