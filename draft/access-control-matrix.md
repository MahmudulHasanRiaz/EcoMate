# Access Control Matrix (Current Running System)

This file is a snapshot of the current role permissions and the current sidebar/page routes.
No new system is applied yet. You can edit this file and I will implement your edits.

Legend:
- CRUD = create/read/update/delete
- CRU = create/read/update
- RU = read/update
- R = read-only
- NONE = no access

Modules (data permissions):
orders, packingOrders, products, inventory, customers, purchases, expenses, checkPassing, partners,
courierReport, courierManagement, staff, settings, analytics, issues, attendance, accounting

Current Role -> Module Permissions (from src/lib/staff-permissions.ts)

Admin:
- All modules: CRUD

Manager:
- orders: CRU
- packingOrders: CRU
- products: CRU
- inventory: CRU
- customers: CRU
- purchases: CRU
- expenses: CRU
- checkPassing: R
- partners: CRU
- courierReport: CRU
- courierManagement: CRU
- staff: CRU (no delete)
- settings: CRU (no delete)
- analytics: CRU (no delete)
- issues: CRU
- attendance: CRU
- accounting: CRU (no delete)

Moderator:
- orders: CRU
- packingOrders: CRU
- products: RU
- inventory: RU
- customers: CRU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: RU
- issues: CRU
- attendance: CRU
- accounting: R

Seller:
- orders: CRU
- packingOrders: CRU
- products: RU
- inventory: RU
- customers: CRU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: RU
- issues: CRU
- attendance: CRU
- accounting: R

Packing Assistant:
- orders: R
- packingOrders: RU
- products: RU
- inventory: RU
- customers: RU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: R
- issues: R
- attendance: CRU
- accounting: R

Call Assistant:
- orders: RU
- packingOrders: RU
- products: RU
- inventory: RU
- customers: RU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: R
- issues: R
- attendance: CRU
- accounting: R

Call Centre Manager:
- orders: RU
- packingOrders: RU
- products: RU
- inventory: RU
- customers: RU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: R
- issues: R
- attendance: CRU
- accounting: R

Courier Manager:
- orders: RU
- packingOrders: RU
- products: RU
- inventory: RU
- customers: RU
- purchases: R
- expenses: RU
- checkPassing: R
- partners: R
- courierReport: R
- courierManagement: RU
- staff: RU
- settings: R
- analytics: R
- issues: R
- attendance: CRU
- accounting: R

Partner:
- orders: None
- packingOrders: None
- products: R
- inventory: R
- customers: None
- purchases: RU
- expenses: None
- checkPassing: R
- partners: RU
- courierReport: None
- courierManagement: None
- staff: None
- settings: R
- analytics: RU
- issues: None
- attendance: None
- accounting: R

Vendor/Supplier:
- orders: None
- packingOrders: None
- products: R
- inventory: R
- customers: None
- purchases: RU
- expenses: None
- checkPassing: R
- partners: RU
- courierReport: None
- courierManagement: None
- staff: None
- settings: R
- analytics: RU
- issues: None
- attendance: None
- accounting: R

Default (fallback):
- All modules: None

Current Page/Sidebar Routes (from src/app/dashboard/layout-client.tsx)
- /dashboard
- /dashboard/orders/all
- /dashboard/orders/incomplete
- /dashboard/issues
- /dashboard/packing-orders
- /dashboard/courier-report
- /dashboard/courier
- /dashboard/courier/steadfast
- /dashboard/courier/carrybee
- /dashboard/courier/pathao
- /dashboard/products
- /dashboard/inventory
- /dashboard/customers
- /dashboard/purchases
- /dashboard/expenses
- /dashboard/check-passing
- /dashboard/partners
- /dashboard/analytics
- /coming-soon (Accounting placeholder)
- /dashboard/staff
- /dashboard/attendance
- /dashboard/settings

Proposed New Page Access Keys (NOT implemented yet)
Use these as separate page-level gates, independent from data permissions:
- pages.dashboard -> /dashboard
- pages.orders -> /dashboard/orders/*
- pages.issues -> /dashboard/issues
- pages.packingOrders -> /dashboard/packing-orders
- pages.courierReport -> /dashboard/courier-report
- pages.courierManagement -> /dashboard/courier/*
- pages.products -> /dashboard/products
- pages.inventory -> /dashboard/inventory
- pages.customers -> /dashboard/customers
- pages.purchases -> /dashboard/purchases
- pages.expenses -> /dashboard/expenses
- pages.checkPassing -> /dashboard/check-passing
- pages.partners -> /dashboard/partners
- pages.analytics -> /dashboard/analytics
- pages.accounting -> /coming-soon (accounting)
- pages.staff -> /dashboard/staff
- pages.attendance -> /dashboard/attendance
- pages.settings -> /dashboard/settings

Notes:
- Today the sidebar and page access are gated by module read permissions only.
- After you edit this file, I will implement separate page access gates.

Role -> Page Access (allow-list)
Use only these allow lists to gate page access (anything not listed is denied).

Admin:
- allow: pages.*

Manager:
- allow: pages.dashboard, pages.orders, pages.issues, pages.packingOrders, pages.courierReport, pages.courierManagement, pages.products, pages.inventory, pages.customers, pages.purchases, pages.expenses, pages.checkPassing, pages.partners, pages.accounting, pages.staff, pages.attendance, pages.settings
- deny: pages.analytics

Vendor/Supplier:
- allow: pages.accounting, pages.partners, pages.checkPassing, pages.purchases

Partner:
- allow: pages.accounting, pages.partners, pages.checkPassing, pages.purchases

Courier Manager:
- allow: pages.dashboard, pages.orders, pages.issues, pages.courierReport, pages.courierManagement, pages.customers, pages.accounting

Call Centre Manager:
- allow: pages.dashboard, pages.products, pages.orders, pages.issues, pages.courierReport, pages.customers, pages.accounting, pages.attendance

Call Assistant:
- allow: pages.dashboard, pages.products, pages.orders, pages.issues, pages.courierReport, pages.customers, pages.accounting

Packing Assistant:
- allow: pages.dashboard, pages.packingOrders

Seller:
- allow: pages.dashboard, pages.products, pages.orders, pages.issues, pages.courierReport, pages.customers, pages.accounting

Moderator:
- allow: pages.dashboard, pages.products, pages.orders, pages.issues, pages.courierReport, pages.customers, pages.accounting
