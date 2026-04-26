# Courier Management Module - Updated Plan (v4)

একটি পূর্ণাঙ্গ Courier Reconciliation + Payment Tracking মডিউল, যেখানে per-parcel charge tracking, manual adjustment, এবং business-wise courier contract settings থাকবে।

---

## ✅ ফাইনাল রিকোয়ারমেন্টস (আপডেটেড)

1) নতুন পারমিশন: `courierManagement`
2) actualCodAmount = total - paidAmount (Due)
3) চার্জ জোন = Inside / Sub / Outside
   - Inside = Dhaka
   - Sub = Dhaka, Narayanganj, Gazipur + extra city/zone (configurable)
   - Outside = বাকি সব
4) COD charge % (0-100) business-wise per courier integration
5) Return parcels-এ delivery charge ধরতে হবে (payment হিসাবের অংশ), COD charge হবে না

নোট:
- অর্ডারের shipping charge আগের মতোই থাকবে; এই module-এ fixed courier charge শুধু reconciliation-এর জন্য।
- Order page-এ courier charge দেখানো/এডিট করা হবে না।

---

## 🔐 Permissions

- নতুন পারমিশন মডিউল যোগ হবে: `courierManagement`
- Update required:
  - `src/types/index.ts`
  - `src/lib/permissions.ts`
  - `src/lib/staff-permissions.ts`
  - Staff UI permission lists
  - `src/hooks/use-authorization.ts`
  - `src/app/dashboard/layout-client.tsx`

---

## 🧱 Database Changes

### 1) Order Table Extensions
```prisma
actualCodAmount       Float?
courierCodCharge      Float?
courierDeliveryCharge Float?
courierNetPayable     Float?
chargesLastUpdated    DateTime?
chargesUpdatedBy      String?

@@index([courierService, status, courierDispatchedAt])
```

### 2) CourierPayment (Manual Entries)
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

---

## ⚙️ Courier Integration Settings (Business-wise)

এই সেটিংসগুলো existing Courier Integration dialog-এ যুক্ত হবে (প্রতিটি business + courier আলাদা):

### Rate Config (Required)
- COD Charge % (0-100)
- Delivery Charge:
  - Inside Charge
  - Sub-area Charge
  - Outside Charge

### Zone Mapping Config
Inside/Sub/Outside হিসেবে কোন city/zone পড়বে সেটি কনফিগার করা যাবে।

**স্টোরেজ প্ল্যান**
`CourierIntegration.credentials.rateConfig` JSON এর ভেতরে থাকবে:
```ts
rateConfig: {
  codChargePercent: number,
  insideCharge: number,
  subCharge: number,
  outsideCharge: number,
  zoneMap: {
    insideCityIds: number[],
    subCityIds: number[],
    subZoneIds: number[],
    insideZoneIds?: number[]
  }
}
```

**ম্যাপিং লজিক** (প্রাধান্যক্রমে):
1) courierZoneId ∈ subZoneIds -> Sub
2) courierZoneId ∈ insideZoneIds -> Inside
3) courierCityId ∈ insideCityIds -> Inside
4) courierCityId ∈ subCityIds -> Sub
5) else -> Outside

Pathao/Carrybee: city/zone list থেকে সিলেক্ট করা হবে।
Steadfast: city/zone id নেই, তাই Pathao/Carrybee stored city/zone ID দিয়েই mapping হবে।

---

## 🧮 Charge Calculation Logic

**actualCodAmount (default)**
`actualCodAmount = max(total - paidAmount, 0)`

**COD Charge**
`courierCodCharge = actualCodAmount * (codChargePercent / 100)`

**Delivery Charge**
Inside/Sub/Outside mapping অনুযায়ী নির্ধারণ হবে।

**Net Payable**
`courierNetPayable = actualCodAmount - courierCodCharge - courierDeliveryCharge`

**Return Orders**
- Return Pending/Returned এর ক্ষেত্রে COD charge = 0
- Delivery charge হবে fixed rate (Inside/Sub/Outside) অনুযায়ী

---

## 🔧 Auto-fill + Manual Adjustment Flow

### Auto-fill (Dispatch Time)
- Dispatch সফল হলে config থেকে charge হিসাব করে order-এ save হবে।
- Dispatch-ই একমাত্র auto-fill ট্রিগার হবে।

### Manual Adjustment (Courier Module only)
- Order page-এ edit থাকবে না।
- Courier Management মডিউল থেকে Bulk Update/Statement reconciliation হবে।

CSV Columns:
```
orderNumber, actualCodAmount, courierCodCharge, courierDeliveryCharge
```

---

## 🔄 Return Parcel Handling

Return orders Expected COD-এ অন্তর্ভুক্ত হবে না, কিন্তু delivery charge অবশ্যই deduction হবে।

---

## 📊 Metrics (Dashboard)

1) Total Parcels: Dispatched (excluding Return Pending)
2) Total COD Sent: Sum actualCodAmount (excluding Return Pending/Returned)
3) Total Charges: courierCodCharge + courierDeliveryCharge (Returned orders-এর delivery charge সহ)
4) Expected Payment: COD Sent - Total Charges
5) Received Payment: Manual payment entries
6) Pending Payment: Expected - Received
7) Return Pending: Count + COD
8) Return Charges: Returned orders-এর delivery charge sum

---

## 🧩 API Routes

- `GET /api/courier/metrics`
- `GET/POST /api/courier/payments`
- `POST /api/courier/charges/bulk`

(Integration config save/read আগের `/api/settings/integrations/courier` দিয়েই হবে)

All routes -> `enforcePermission('courierManagement', ...)`

---

## 🖥️ Frontend Pages

- `/dashboard/courier` (All Couriers)
- `/dashboard/courier/steadfast`
- `/dashboard/courier/carrybee`
- `/dashboard/courier/pathao`

UI sections:
- KPI cards
- Payments table + Add Payment dialog
- Bulk Charge Update tool
- Return Pending list

---

## ✅ Phases (Revised)

**Phase 1: Permissions + Schema**
- Add courierManagement permission
- Extend Order
- Add CourierPayment table

**Phase 2: Settings Update**
- Integration UI-তে rate config + zone mapping যোগ
- Save in credentials JSON

**Phase 3: Dispatch Auto-fill**
- Dispatch modules update (Steadfast/Carrybee/Pathao)

**Phase 4: Manual Edit + Bulk Update**
- Bulk update CSV tool

**Phase 5: Metrics + Dashboard**
- Reconciliation module + new pages

**Phase 6: Payment Tracking**
- Payments API + UI history
