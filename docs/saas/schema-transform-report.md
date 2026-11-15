# Tenant schema transformation report

Source: `apps/backend/prisma/schema.prisma`
Proposed schema: `apps/backend/prisma/schema.tenant.prisma`

## Summary

- tenantId added: **196**
- existing tenantId normalized: **2**
- field-level uniques converted: **63**
- composite uniques prefixed: **12**
- indexes prefixed: **401**
- standalone tenant indexes: **39**
- specialized indexes kept: **7**
- primary keys rewritten: **5**
- license models removed: **2**
- global reference models: **3**

## Primary key rewrites

- SystemSetting: field @id removed from `key`
- CourierAuthToken: field @id removed from `courier`
- OrderCounter: @@id -> @@id([tenantId, date, family])
- ReturnCounter: field @id removed from `date`
- PurchaseCounter: field @id removed from `date`

## Field-level uniques converted

- UserProfile.username -> @@unique([tenantId, username])
- UserProfile.email -> @@unique([tenantId, email])
- betterAuthUser.email -> @@unique([tenantId, email])
- AccessPreset.name -> @@unique([tenantId, name])
- AuthSettings.providerName -> @@unique([tenantId, providerName])
- CustomerProfile.externalId -> @@unique([tenantId, externalId])
- CustomerProfile.phone -> @@unique([tenantId, phone])
- CustomerPhone.phone -> @@unique([tenantId, phone])
- Task.displayId -> @@unique([tenantId, displayId])
- Category.slug -> @@unique([tenantId, slug])
- Brand.slug -> @@unique([tenantId, slug])
- Attribute.name -> @@unique([tenantId, name])
- Product.slug -> @@unique([tenantId, slug])
- ProductVariant.sku -> @@unique([tenantId, sku])
- Combo.slug -> @@unique([tenantId, slug])
- OrderStatus.name -> @@unique([tenantId, name])
- Order.displayId -> @@unique([tenantId, displayId])
- Order.idempotencyKey -> @@unique([tenantId, idempotencyKey])
- Payment.providerPaymentId -> @@unique([tenantId, providerPaymentId])
- CheckoutLead.displayId -> @@unique([tenantId, displayId])
- EmailTemplate.name -> @@unique([tenantId, name])
- PaymentGateway.code -> @@unique([tenantId, code])
- CourierCredentials.courier -> @@unique([tenantId, courier])
- Return.displayId -> @@unique([tenantId, displayId])
- Coupon.code -> @@unique([tenantId, code])
- CmsPage.slug -> @@unique([tenantId, slug])
- CmsPage.templateKey -> @@unique([tenantId, templateKey])
- JobPosting.slug -> @@unique([tenantId, slug])
- BlockedIp.ip -> @@unique([tenantId, ip])
- BlockedPhone.phone -> @@unique([tenantId, phone])
- SecurityEvent.dedupKey -> @@unique([tenantId, dedupKey])
- Tag.name -> @@unique([tenantId, name])
- Tag.slug -> @@unique([tenantId, slug])
- LandingPage.slug -> @@unique([tenantId, slug])
- ExpenseCategory.slug -> @@unique([tenantId, slug])
- Supplier.slug -> @@unique([tenantId, slug])
- Purchase.referenceNo -> @@unique([tenantId, referenceNo])
- Referral.code -> @@unique([tenantId, code])
- Department.name -> @@unique([tenantId, name])
- Department.slug -> @@unique([tenantId, slug])
- Designation.name -> @@unique([tenantId, name])
- Designation.slug -> @@unique([tenantId, slug])
- Employee.employeeId -> @@unique([tenantId, employeeId])
- ShiftPreset.name -> @@unique([tenantId, name])
- ShiftPreset.code -> @@unique([tenantId, code])
- Account.code -> @@unique([tenantId, code])
- JournalEntry.entryNo -> @@unique([tenantId, entryNo])
- Warehouse.slug -> @@unique([tenantId, slug])
- CostingLot.lotNumber -> @@unique([tenantId, lotNumber])
- StockTransfer.idempotencyKey -> @@unique([tenantId, idempotencyKey])
- GoodsReceiptNote.grnNumber -> @@unique([tenantId, grnNumber])
- GoodsReceiptNote.clientKey -> @@unique([tenantId, clientKey])
- SupplierPaymentInvoice.invoiceNo -> @@unique([tenantId, invoiceNo])
- MarketingBusiness.providerBusinessId -> @@unique([tenantId, providerBusinessId])
- AdAccount.providerAccountId -> @@unique([tenantId, providerAccountId])
- MarketingCampaign.providerCampaignId -> @@unique([tenantId, providerCampaignId])
- MarketingAdSet.providerAdSetId -> @@unique([tenantId, providerAdSetId])
- MarketingAd.providerAdId -> @@unique([tenantId, providerAdId])
- MarketingPayment.providerPaymentId -> @@unique([tenantId, providerPaymentId])
- LeaveType.name -> @@unique([tenantId, name])
- LeaveType.code -> @@unique([tenantId, code])
- RawAttendanceEvent.idempotencyKey -> @@unique([tenantId, idempotencyKey])
- CourierSettlementInvoice.displayId -> @@unique([tenantId, displayId])

## Composite uniques prefixed

- Payment: [transactionId, gatewayCode] -> [tenantId, transactionId, gatewayCode]
- CourierCredentialSet: [courier, label] -> [tenantId, courier, label]
- CourierReportCache: [courier, phone] -> [tenantId, courier, phone]
- Dispatch: [courier, consignmentId] -> [tenantId, courier, consignmentId]
- WebhookAttempt: [courier, idempotencyKey] -> [tenantId, courier, idempotencyKey]
- Expense: [sourceType, sourceId] -> [tenantId, sourceType, sourceId]
- NotificationSetting: [channel, type] -> [tenantId, channel, type]
- FinancialPeriod: [startDate, endDate] -> [tenantId, startDate, endDate]
- TrackingSnapshot: [orderId, eventType] -> [tenantId, orderId, eventType]
- MarketingDailyProductCost: [productId, date] -> [tenantId, productId, date]
- CourierSettlementColumnAlias: [courier, sourceHeader] -> [tenantId, courier, sourceHeader]
- CourierSettlementFinanceRule: [courier, format] -> [tenantId, courier, format]

## Specialized indexes kept

- CustomerProfile: @@index([name(ops: raw("gin_trgm_ops"))])
- Product: @@index([sku(ops: raw("gin_trgm_ops"))])
- Product: @@index([name(ops: raw("gin_trgm_ops"))])
- Product: @@index([slug(ops: raw("gin_trgm_ops"))])
- ProductVariant: @@index([sku(ops: raw("gin_trgm_ops"))])
- Order: @@index([displayId(ops: raw("gin_trgm_ops"))])
- Order: @@index([guestName(ops: raw("gin_trgm_ops"))])

## Global reference models

- PaymentOption
- MarketingPlatform
- SourcePlatform

## Removed license models

- LicenseActivationHistory
- LicenseActivation
