**Bootstrap Admin Setup (Option A)**

Goal: একটাই প্রস্তুত Admin অ্যাকাউন্ট রাখা, যাতে প্রথম লগইন থেকেই ইনভাইটেশন পাঠানো যায়। এটি ক্লাউড/VPS ডেপ্লয়ের জন্য; serverless নয়।

---

### 1) লোকাল/সার্ভার DB সিড
1) `.env.local` (বা সার্ভার env) এ ডাইরেক্ট Postgres URL সেট করুন:  
   `DATABASE_URL=postgres://postgres:123456@localhost:5432/ecomate?schema=public`  
   `DIRECT_DATABASE_URL=...` (একই URL)  
2) মাইগ্রেশন চালান:  
   ```bash
   npx prisma migrate deploy
   ```
3) বুটস্ট্র্যাপ অ্যাডমিন সিড করুন:  
   ```bash
   node scripts/bootstrap-admin.js
   ```
   এটি `hello@riaz.com.bd`, ফোন `8801601701567`, নাম `Mahmudul Hasan Riaz` সহ এক Admin রেকর্ড তৈরি/আপডেট করবে। `clerkId` সাময়িকভাবে `bootstrap_clerk_tbd` থাকবে।

### 2) Clerk ইউজার তৈরি ও মেটাডাটা
1) Clerk Dashboard → Users → Add user: একই `email/phone/name` দিন।  
2) Public metadata সেট করুন (create বা পরে update):  
   ```json
   {
     "role": "Admin",
     "permissions": {
       "orders":          { "create": true, "read": true, "update": true, "delete": true },
       "packingOrders":   { "create": true, "read": true, "update": true, "delete": true },
       "products":        { "create": true, "read": true, "update": true, "delete": true },
       "inventory":       { "create": true, "read": true, "update": true, "delete": true },
       "customers":       { "create": true, "read": true, "update": true, "delete": true },
       "purchases":       { "create": true, "read": true, "update": true, "delete": true },
       "expenses":        { "create": true, "read": true, "update": true, "delete": true },
       "checkPassing":    { "create": true, "read": true, "update": true, "delete": true },
       "partners":        { "create": true, "read": true, "update": true, "delete": true },
       "courierReport":   { "create": true, "read": true, "update": true, "delete": true },
       "staff":           { "create": true, "read": true, "update": true, "delete": true },
       "settings":        { "create": true, "read": true, "update": true, "delete": true },
       "analytics":       { "create": true, "read": true, "update": true, "delete": true },
       "issues":          { "create": true, "read": true, "update": true, "delete": true },
       "attendance":      { "create": true, "read": true, "update": true, "delete": true },
       "accounting":      { "create": true, "read": true, "update": true, "delete": true }
     },
     "accessibleBusinessIds": [],      // সব Business এর ID দিলে ফাঁকা রাখুন বা লিস্ট দিন
     "paymentType": "Both",
     "salaryDetails": { "amount": 0, "frequency": "Monthly" },
     "commissionDetails": { "targetCount": 0, "targetPeriod": null, "targetEnabled": false }
   }
   ```
3) পাসওয়ার্ড বা magic link দিন (গোপন রাখুন)।

### 3) DB ↔ Clerk লিঙ্ক করা
1) Clerk user ID কপি করুন (যেমন `user_abc123`).  
2) DB-তে আপডেট করুন (psql বা Prisma script):  
   ```sql
   UPDATE "StaffMember"
   SET "clerkId" = '<clerk_user_id>', "staffCode" = "staffCode"
   WHERE email = 'hello@riaz.com.bd';
   ```
3) Clerk public_metadata-তে `staffId` / `staffCode` লিখে দিন:  
   ```json
   {
     "role": "Admin",
     "permissions": { /* full admin */ },
     "accessibleBusinessIds": [],
     "paymentType": "Both",
     "salaryDetails": { "amount": 0, "frequency": "Monthly" },
     "commissionDetails": { "targetCount": 0, "targetPeriod": null, "targetEnabled": false },
     "staffId": "<db-staff-id>",
     "staffCode": "<db-staff-code>"
   }
   ```

### 4) যাচাই
- `npm run dev` বা সার্ভার চালিয়ে Clerk Admin দিয়ে লগইন করুন।  
- `/api/auth/whoami` should return `status: ok` এবং Admin permissions; Dashboard মেনু দেখা যাবে।  
- তারপর স্টাফ পেজ থেকে স্বাভাবিক ইনভাইটেশন পাঠান। কাজ শেষ হলে চাইলে বুটস্ট্র্যাপ অ্যাডমিন disable/delete করতে পারেন, তবে অন্তত একটিতে fallback admin রেখে দিন।

### নিরাপত্তা
- বুটস্ট্র্যাপ অ্যাডমিন ক্রেডেনশিয়াল গোপন রাখুন, 2FA চালু করুন।  
- প্রোডে Clerk-এ পাস রোটেশন ও সেশন রিভোক নীতি ব্যবহার করুন।  
- কোনো সিড/SQL-এ ক্রেডেনশিয়াল কমিট করবেন না; env দিয়ে ইনজেক্ট করুন।
