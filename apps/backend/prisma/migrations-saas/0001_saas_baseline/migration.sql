-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Required by the trgm GIN indexes generated from the search indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('superadmin', 'admin', 'cashier', 'packing_assistant', 'customer', 'employee');

-- CreateEnum
CREATE TYPE "AvailabilityMode" AS ENUM ('ALWAYS_IN_STOCK', 'ALWAYS_OUT_OF_STOCK', 'MANAGED_STOCK', 'INVENTORY_CONTROLLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('backlog', 'todo', 'in progress', 'done', 'canceled');

-- CreateEnum
CREATE TYPE "TaskLabel" AS ENUM ('bug', 'feature', 'documentation');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TaskTimeEntryStatus" AS ENUM ('active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "PaymentOptionType" AS ENUM ('FULL_PAYMENT', 'PARTIAL_PAYMENT', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAYMENT_PENDING', 'PENDING', 'PAID', 'PARTIAL_PAID', 'PARTIAL_REFUNDED', 'UNPAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PAYMENT_VERIFYING', 'VOID');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('main', 'showroom', 'storage');

-- CreateEnum
CREATE TYPE "CostingLotConsumptionType" AS ENUM ('FULFILLMENT', 'ADJUSTMENT', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'ECOMMERCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('SALE', 'RETURN', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('CALL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP', 'THREADS', 'WALK_IN', 'WEBSITE', 'OFFLINE', 'POS', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesChannelV2" AS ENUM ('WEBSITE', 'MESSAGING', 'PHONE_CALL', 'POS');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('PAID', 'ORGANIC', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CustomerAddressType" AS ENUM ('SHIPPING', 'BILLING');

-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CourierService" AS ENUM ('steadfast', 'pathao', 'redx', 'carrybee');

-- CreateEnum
CREATE TYPE "CourierCancelMode" AS ENUM ('API', 'MANUAL');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('DISPATCHED', 'HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'PICKUP_FAILED', 'ASSIGNED_TO_HUB', 'HOLD', 'DELIVERED', 'PARTIAL', 'RETURN_PENDING', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('FULL', 'PARTIAL', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'RESTOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReturnSource" AS ENUM ('STAFF', 'COURIER', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "WebhookAttemptOutcome" AS ENUM ('SUCCESS', 'AUTH_FAILED', 'AUTH_HEADER_MISSING', 'AUTH_FORMAT_INVALID', 'RATE_LIMITED', 'PAYLOAD_INVALID', 'ORDER_NOT_FOUND', 'PROCESSING_ERROR', 'SKIPPED', 'UNKNOWN_ERROR');

-- CreateEnum
CREATE TYPE "WebhookAttemptStage" AS ENUM ('RATE_LIMIT', 'AUTH', 'PAYLOAD', 'ORDER_RESOLUTION', 'PROCESSING', 'RESPONSE');

-- CreateEnum
CREATE TYPE "ManagedStockMovementType" AS ENUM ('INITIAL', 'ORDER_DEDUCTION', 'MANUAL_ADD', 'MANUAL_REMOVE', 'ADJUSTMENT', 'RETURN', 'CANCEL_RELEASE', 'RESERVE', 'RELEASE', 'RETURN_HOLD', 'PURCHASE_RECEIVE');

-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ReferenceEntity" AS ENUM ('ORDER', 'ORDER_ITEM', 'RETURN', 'MANUAL', 'ADJUSTMENT', 'IMPORT', 'PURCHASE');

-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "SecurityEventCategory" AS ENUM ('RATE_LIMIT', 'AUTH', 'FRAUD', 'BLOCK', 'SYSTEM', 'WAF', 'BOT', 'THREAT_INTEL');

-- CreateEnum
CREATE TYPE "SecurityActorType" AS ENUM ('IP', 'USER', 'SESSION', 'BROWSER_TRUST', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'internship');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive', 'terminated', 'resigned', 'on_leave', 'suspended');

-- CreateEnum
CREATE TYPE "EmploymentHistoryField" AS ENUM ('status', 'department', 'designation', 'reporting_manager', 'employment_type', 'weekly_off', 'shift', 'personalInformation', 'employmentInformation', 'bankAccount');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('draft', 'reviewed', 'approved', 'partially_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('bonus', 'incentive', 'commission', 'other');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('fine', 'other');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('draft', 'approved', 'paid');

-- CreateEnum
CREATE TYPE "CommissionAmountType" AS ENUM ('fixed', 'percent');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "MarketingPlatformSlug" AS ENUM ('facebook', 'google_ads', 'tiktok', 'linkedin');

-- CreateEnum
CREATE TYPE "MarketingConnectionStatus" AS ENUM ('connected', 'disconnected', 'expired', 'error');

-- CreateEnum
CREATE TYPE "MarketingFundingStatus" AS ENUM ('draft', 'confirmed', 'posted', 'partially_consumed', 'fully_consumed', 'archived');

-- CreateEnum
CREATE TYPE "MarketingAllocationMethod" AS ENUM ('equal', 'product_value', 'quantity');

-- CreateEnum
CREATE TYPE "MarketingPaymentStatus" AS ENUM ('pending', 'reconciled', 'needs_review', 'failed');

-- CreateEnum
CREATE TYPE "MarketingFundingType" AS ENUM ('paid', 'promotional');

-- CreateEnum
CREATE TYPE "OrderAttributionMethod" AS ENUM ('fbclid', 'click_id', 'conversion_api', 'pixel', 'session', 'utm', 'manual');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'WEEKLY_OFF');

-- CreateEnum
CREATE TYPE "EmployeeGender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('APP', 'MACHINE', 'NONE');

-- CreateEnum
CREATE TYPE "AttendanceModeSetting" AS ENUM ('APP', 'MACHINE', 'BOTH');

-- CreateEnum
CREATE TYPE "AttendanceSessionSource" AS ENUM ('APP', 'MACHINE', 'ADMIN');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT', 'OTHERS');

-- CreateEnum
CREATE TYPE "BankVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceDeviceSyncStatus" AS ENUM ('IDLE', 'CONNECTED', 'DISCONNECTED', 'SYNCING', 'FAILED');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'PUNCH');

-- CreateEnum
CREATE TYPE "AttendanceEventStatus" AS ENUM ('PENDING', 'UNMAPPED', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CourierSettlementInvoiceState" AS ENUM ('UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED', 'IMPORTING', 'READY_FOR_REVIEW', 'REVIEW_REQUIRED', 'ISSUE_FOUND', 'FINALIZING', 'FINALIZED_PENDING_ACCOUNTING', 'ACCOUNTING_POSTED', 'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED', 'ACCOUNTING_FAILED', 'ADJUSTED', 'RECONCILED', 'DISCARDED', 'SUPERSEDED_BY_REVISION');

-- CreateEnum
CREATE TYPE "CourierSettlementRowClass" AS ENUM ('DATA', 'SUMMARY', 'FOOTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CourierSettlementRowKind" AS ENUM ('DELIVERY', 'RETURN', 'FEE_ONLY', 'BILLING_ONLY', 'ADJUSTMENT', 'SUMMARY', 'FOOTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CourierSettlementMatchMethod" AS ENUM ('BY_CONSIGNMENT', 'BY_TRACKING', 'BY_ORDER_DISPLAYID', 'BY_ORDER_EXTERNALID', 'BY_ORDER_CUSTOMER', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "CourierSettlementAccountingStatus" AS ENUM ('PENDING', 'POSTED', 'SKIPPED_ACCOUNTING_DISABLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CourierSettlementActivityAction" AS ENUM ('IMPORTED', 'MAPPED', 'MATCHED', 'FINALIZED', 'SNAPSHOT_TAKEN', 'POSTED_ACCOUNTING', 'ACCOUNTING_REPAIRED', 'ADJUSTED', 'REVISED', 'REVISION_LINKED', 'SUPERSEDED_BY_REVISION', 'EFFECTIVE_STATE_CHANGED', 'ACKNOWLEDGED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "CourierSettlementAliasOrigin" AS ENUM ('SYSTEM', 'LEARNED', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockoutUntil" TIMESTAMP(3),
    "lastIp" TEXT,
    "betterAuthUserId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "better_auth_users" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT DEFAULT 'customer',
    "override_permissions" TEXT[],
    "denied_permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "better_auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPreset" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_settings" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "betterAuthUserId" TEXT,
    "externalId" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastOrderIp" TEXT,
    "lastOrderAt" TIMESTAMP(3),

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPhone" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'secondary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "label" "TaskLabel" NOT NULL DEFAULT 'feature',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "assignee" TEXT,
    "assignedEmployeeId" TEXT,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimeEntry" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskTimeEntryStatus" NOT NULL DEFAULT 'completed',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "font" TEXT NOT NULL DEFAULT 'inter',
    "username" TEXT,
    "email" TEXT,
    "bio" TEXT,
    "urls" TEXT,
    "accountName" TEXT,
    "accountDob" TEXT,
    "accountLanguage" TEXT,
    "notificationType" TEXT NOT NULL DEFAULT 'all',
    "notificationMobile" BOOLEAN NOT NULL DEFAULT false,
    "notificationCommunicationEmail" BOOLEAN NOT NULL DEFAULT false,
    "notificationSocialEmail" BOOLEAN NOT NULL DEFAULT false,
    "notificationMarketingEmail" BOOLEAN NOT NULL DEFAULT false,
    "notificationSecurityEmail" BOOLEAN NOT NULL DEFAULT true,
    "displayItems" TEXT,
    "autoVariantSelect" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerProfileId" TEXT,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "type" "CustomerAddressType" NOT NULL DEFAULT 'SHIPPING',
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "area" TEXT,
    "thana" TEXT,
    "district" TEXT,
    "division" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "normalizedHash" TEXT,
    "sourceOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "image" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showInMenu" BOOLEAN NOT NULL DEFAULT true,
    "menuSortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sizeChartId" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "Brand" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribute" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "swatchFit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeValue" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "hexCode" TEXT,
    "image" TEXT,
    "attributeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'simple',
    "description" TEXT,
    "shortDesc" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "salePrice" DECIMAL(10,2),
    "effectivePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sku" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockQty" INTEGER,
    "weightGram" INTEGER,
    "customizations" JSONB,
    "availabilityMode" "AvailabilityMode" NOT NULL DEFAULT 'MANAGED_STOCK',
    "standardCost" DECIMAL(10,2),
    "categoryId" TEXT,
    "tags" JSONB DEFAULT '[]',
    "images" JSONB DEFAULT '[]',
    "seoMeta" JSONB DEFAULT '{}',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "manageStock" BOOLEAN NOT NULL DEFAULT false,
    "syncManagedStock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brandId" TEXT,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT,
    "defaultBinLocationId" TEXT,
    "sizeChartId" TEXT,
    "videoUrl" TEXT,
    "detailRows" JSONB,
    "descriptionSections" JSONB,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2),
    "salePrice" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "standardCost" DECIMAL(10,2),
    "image" TEXT,
    "images" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT,
    "binLocationId" TEXT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantAttributeValue" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,

    CONSTRAINT "ProductVariantAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combo" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "shortDesc" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "salePrice" DECIMAL(10,2),
    "image" TEXT,
    "images" JSONB DEFAULT '[]',
    "categoryId" TEXT,
    "tags" JSONB DEFAULT '[]',
    "seoMeta" JSONB DEFAULT '{}',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "manageStock" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSession" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "showroomId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "openingBalance" DECIMAL(10,2) NOT NULL,
    "closingBalance" DECIMAL(10,2),
    "expectedBalance" DECIMAL(10,2),
    "status" "PosSessionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingLock" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PackingLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEditLock" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderEditLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatus" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "nextStatuses" JSONB DEFAULT '[]',
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL DEFAULT 'SALE',
    "returnOfOrderId" TEXT,
    "exchangeOfOrderId" TEXT,
    "exchangeScope" TEXT,
    "returnedAt" TIMESTAMP(3),
    "stockRestored" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,
    "statusId" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "shippingCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'flat',
    "autoDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "autoDiscountBreakdown" JSONB,
    "total" DECIMAL(10,2) NOT NULL,
    "shippingAddress" JSONB DEFAULT '{}',
    "billingAddress" JSONB DEFAULT '{}',
    "customerNotes" TEXT,
    "officeNotes" TEXT,
    "courierService" "CourierService",
    "courierConsignmentId" TEXT,
    "courierTrackingCode" TEXT,
    "courierStatus" TEXT,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "timeline" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "secondaryPhone" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerFirstName" TEXT,
    "customerLastName" TEXT,
    "customerCity" TEXT,
    "customerState" TEXT,
    "customerZip" TEXT,
    "customerCountry" TEXT DEFAULT 'BD',
    "paymentOptionType" "PaymentOptionType",
    "source" "OrderSource" DEFAULT 'ECOMMERCE',
    "salesChannel" "SalesChannel",
    "sourcePlatform" TEXT,
    "sourceType" TEXT,
    "sourceEntity" TEXT,
    "channel" "SalesChannelV2",
    "channelEntity" TEXT,
    "sourceSlug" TEXT,
    "acquisitionType" "AcquisitionType",
    "channelMappedAt" TIMESTAMP(3),
    "posSessionId" TEXT,
    "idempotencyKey" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "paymentProof" JSONB DEFAULT '{}',
    "partialAmount" DECIMAL(10,2),
    "viewToken" TEXT,
    "trackingSessionId" TEXT,
    "selectedShippingOptionId" TEXT,
    "shippingChargeOverridden" BOOLEAN NOT NULL DEFAULT false,
    "shippingCost" DECIMAL(10,2),
    "shippingCostSource" TEXT,
    "trashedAt" TIMESTAMP(3),
    "exchangedCreditAmount" DECIMAL(10,2),
    "settlementStatus" TEXT,
    "settlementDelta" DECIMAL(10,2),
    "settlementSettledAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "attribution" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "comboId" TEXT,
    "comboSelection" JSONB,
    "customization" JSONB,
    "addonAmount" DECIMAL(10,2),
    "addonCostAmount" DECIMAL(10,2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(10,2) NOT NULL,
    "costSnapshot" DECIMAL(10,2),
    "costType" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "manualName" TEXT,
    "managedStockReserved" BOOLEAN NOT NULL DEFAULT false,
    "managedStockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "sourceWarehouseId" TEXT,
    "sourceOrderItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gatewayCode" TEXT NOT NULL,
    "accountId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "transactionId" TEXT,
    "providerPaymentId" TEXT,
    "screenshot" TEXT,
    "account" TEXT,
    "recordedBy" TEXT,
    "submittedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationSource" TEXT,
    "notes" TEXT,
    "feeAmount" DECIMAL(10,2),
    "sourceOrderId" TEXT,
    "appliedCreditAmount" DECIMAL(10,2),
    "sourcePaymentId" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodMismatchAlert" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "courierAmount" DECIMAL(10,2) NOT NULL,
    "systemDue" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodMismatchAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditEntry" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutLead" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "displayId" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "email" TEXT,
    "address" JSONB,
    "items" JSONB,
    "payload" JSONB,
    "paymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fingerprint" TEXT,
    "ctxId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "trackingNo" TEXT,
    "courier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingOption" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZoneGroup" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "label" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "districts" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZoneGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "templateId" TEXT,
    "content" TEXT,
    "recipients" JSONB DEFAULT '[]',
    "segmentFilter" JSONB DEFAULT '{}',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "PaymentOption" (
    "id" TEXT NOT NULL,
    "type" "PaymentOptionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGateway" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentOptionType" "PaymentOptionType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'personal',
    "phoneNumber" TEXT,
    "accountId" TEXT,
    "credentials" JSONB DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "staffAutoVerifiedOverride" BOOLEAN,
    "editAllowedOverride" BOOLEAN,
    "showOnStorefront" BOOLEAN NOT NULL DEFAULT true,
    "showOnAdmin" BOOLEAN NOT NULL DEFAULT true,
    "showOnPos" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPaymentOption" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "comboId" TEXT,
    "paymentOptionType" "PaymentOptionType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "partialFixedAmount" DECIMAL(10,2),
    "partialPercentage" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPaymentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hash" TEXT,
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sourceUrl" TEXT,
    "uploadedBy" TEXT,
    "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "processingError" TEXT,
    "derivativeManifest" JSONB,
    "blurUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAttachment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierCredentials" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "apiKey" TEXT,
    "secretKey" TEXT,
    "username" TEXT,
    "password" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "clientContext" TEXT,
    "storeId" TEXT,
    "shopId" TEXT,
    "webhookSecret" TEXT,
    "pathaoIntegrationSecret" TEXT,
    "credentials" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierCredentialSet" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL DEFAULT 'steadfast',
    "label" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "secretKeyEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierCredentialSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierDispatchLog" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierDispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierReportCache" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "courierStatus" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierReportCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierAuthToken" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "courier" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierAuthToken_pkey" PRIMARY KEY ("tenant_id","courier")
);

-- CreateTable
CREATE TABLE "Return" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "items" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "source" "ReturnSource" NOT NULL,
    "courier" TEXT,
    "createdBy" TEXT,
    "courierReturnId" TEXT,
    "courierStatus" TEXT,
    "stockReconciled" BOOLEAN NOT NULL DEFAULT false,
    "stockReconciledAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "refundId" TEXT,
    "exchangeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "courier" "CourierService" NOT NULL,
    "courierInvoiceRef" TEXT,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "trackingUrl" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'DISPATCHED',
    "courierStatus" TEXT,
    "courierStatusAt" TIMESTAMP(3),
    "courierAmount" DECIMAL(10,2),
    "courierCancelRef" TEXT,
    "courierCancelAt" TIMESTAMP(3),
    "courierCancelResponse" JSONB,
    "courierCancelMode" "CourierCancelMode",
    "panelCancelConfirmedAt" TIMESTAMP(3),
    "panelCancelConfirmedBy" TEXT,
    "credentialSetId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "productMapping" JSONB DEFAULT '[]',
    "notes" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookAttempt" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "path" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "outcome" "WebhookAttemptOutcome" NOT NULL DEFAULT 'UNKNOWN_ERROR',
    "failureStage" "WebhookAttemptStage",
    "correlationId" TEXT,
    "sourceIp" TEXT,
    "authResult" TEXT,
    "notificationType" TEXT,
    "consignmentId" TEXT,
    "invoice" TEXT,
    "courierEvent" TEXT,
    "message" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,

    CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'flat',
    "value" DECIMAL(10,2) NOT NULL,
    "minOrderValue" DECIMAL(10,2),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerCustomer" INTEGER,
    "percentageCap" DECIMAL(5,2),
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponUsage" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "discount" DECIMAL(10,2) NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SITEWIDE',
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "value" DECIMAL(10,2) NOT NULL,
    "minOrderAmount" DECIMAL(10,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minQuantity" INTEGER,
    "excludeSaleItems" BOOLEAN NOT NULL DEFAULT false,
    "maxDiscountAmount" DECIMAL(10,2),
    "combineWithCoupon" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "maxUsesPerCustomer" INTEGER,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "variantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountApplication" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "notes" TEXT,
    "method" TEXT,
    "exchangeOrderId" TEXT,
    "sourcePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLog" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "comboId" TEXT,
    "quantity" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalInventory" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalInventoryLedger" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reservedBefore" INTEGER,
    "reservedAfter" INTEGER,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "performedBy" TEXT,
    "unitCost" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhysicalInventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalReservation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalReservationAllocation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedStockLedger" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "comboId" TEXT,
    "quantity" INTEGER NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "type" "ManagedStockMovementType" NOT NULL,
    "stockBefore" INTEGER,
    "stockAfter" INTEGER,
    "reservedBefore" INTEGER,
    "reservedAfter" INTEGER,
    "referenceType" "ReferenceEntity",
    "referenceId" TEXT,
    "note" TEXT,
    "reason" TEXT,
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagedStockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCounter" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "date" TEXT NOT NULL,
    "family" TEXT NOT NULL DEFAULT 'ORD',
    "seq" INTEGER NOT NULL,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("tenant_id","date","family")
);

-- CreateTable
CREATE TABLE "ReturnCounter" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "date" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "ReturnCounter_pkey" PRIMARY KEY ("tenant_id","date")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "backupId" TEXT,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "rating" INTEGER,
    "text" TEXT,
    "mobile" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeChart" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "tableData" JSONB DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPage" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showInFooter" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'content',
    "templateKey" TEXT,
    "config" JSONB,
    "metaDescription" TEXT,
    "ogImage" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "location" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'Full-time',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryDisplay" TEXT,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "responsibilities" TEXT,
    "benefits" JSONB,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "jobPostingId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "coverLetter" TEXT,
    "cvUrl" TEXT,
    "cvOriginalName" TEXT,
    "cvDeletedAt" TIMESTAMP(3),
    "cvDeletedById" TEXT,
    "portfolioUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "internalNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreLocation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SHOWROOM',
    "address" TEXT NOT NULL,
    "city" TEXT,
    "district" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hours" TEXT,
    "mapUrl" TEXT,
    "socials" JSONB,
    "photo" TEXT,
    "comingSoon" BOOLEAN NOT NULL DEFAULT false,
    "openingDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportEnquiry" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "repliedById" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedIp" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "blockType" TEXT NOT NULL DEFAULT 'order',
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "autoBlocked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedIp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedPhone" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "autoBlocked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockSettings" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" JSONB NOT NULL,

    CONSTRAINT "BlockSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "SecurityActorType" NOT NULL,
    "ipAddress" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "browserTrustId" TEXT,
    "phone" TEXT,
    "trustTier" TEXT,
    "riskScore" INTEGER,
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT,
    "parentCorrelationId" TEXT,
    "description" TEXT,
    "retentionOverride" BOOLEAN NOT NULL DEFAULT false,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEventHourly" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "bucket" TIMESTAMPTZ(6) NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SecurityEventHourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEventDaily" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SecurityEventDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityBlockDaily" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "blockSource" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SecurityBlockDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityRetentionPolicy" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "category" "SecurityEventCategory" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "criticalRetentionDays" INTEGER,

    CONSTRAINT "SecurityRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTag" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'template',
    "templateId" TEXT,
    "sections" JSONB DEFAULT '[]',
    "customHtml" TEXT,
    "customCss" TEXT,
    "productIds" JSONB DEFAULT '[]',
    "comboIds" JSONB DEFAULT '[]',
    "trackingJson" JSONB DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "expenseKind" TEXT NOT NULL DEFAULT 'unclassified',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "taxId" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalPurchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'draft',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "totalBill" DECIMAL(14,2) NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "shortClosedQty" INTEGER NOT NULL DEFAULT 0,
    "shortCloseReason" TEXT,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEvent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseCounter" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "date" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "PurchaseCounter_pkey" PRIMARY KEY ("tenant_id","date")
);

-- CreateTable
CREATE TABLE "Expense" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "paymentAccountId" TEXT,
    "journalEntryId" TEXT,
    "referenceNo" TEXT,
    "notes" TEXT,
    "receiptUrl" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "totalReferrals" INTEGER NOT NULL DEFAULT 0,
    "totalReward" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLead" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "orderId" TEXT,
    "rewardAmount" DECIMAL(10,2),
    "rewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'coupon',
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "betterAuthUserId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "accessPresetId" TEXT,
    "reportingToId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'full_time',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "salary" DECIMAL(10,2),
    "bankAccountNo" TEXT,
    "bankName" TEXT,
    "profilePictureUrl" TEXT,
    "notes" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "EmployeeGender",
    "nationality" TEXT,
    "nidNumber" TEXT,
    "presentAddress" TEXT,
    "permanentAddress" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelation" TEXT,
    "confirmationDate" TIMESTAMP(3),
    "exitReason" TEXT,
    "attendanceMethod" "AttendanceMethod" NOT NULL DEFAULT 'APP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(10,2) NOT NULL,
    "houseAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "medicalAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "insuranceDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEarning" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EarningType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "applicableFrom" TIMESTAMP(3),
    "applicableTo" TIMESTAMP(3),
    "status" "LedgerStatus" NOT NULL DEFAULT 'draft',
    "payslipId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDeduction" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "applicableFrom" TIMESTAMP(3),
    "applicableTo" TIMESTAMP(3),
    "status" "LedgerStatus" NOT NULL DEFAULT 'draft',
    "payslipId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "triggerStatusId" TEXT,
    "amountType" "CommissionAmountType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "valueBasis" TEXT NOT NULL DEFAULT 'order_total',
    "minOrderAmount" DECIMAL(10,2),
    "capPerOrder" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEarning" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'approved',
    "payslipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(10,2) NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "periodKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PayslipItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "accountId" TEXT,
    "referenceNo" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentHistory" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" "EmploymentHistoryField" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyOff" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPreset" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "standardMinutes" INTEGER NOT NULL,
    "overnight" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftPresetId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "totalDebit" DECIMAL(14,2) NOT NULL,
    "totalCredit" DECIMAL(14,2) NOT NULL,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "referenceNo" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'main',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rack" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shelf" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinLocation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zoneId" TEXT,
    "rackId" TEXT,
    "shelfId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLot" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "grnId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferId" TEXT,
    "sourceConsumptionId" TEXT,

    CONSTRAINT "CostingLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLotConsumption" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "costingLotId" TEXT NOT NULL,
    "type" "CostingLotConsumptionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "cycleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLotId" TEXT,

    CONSTRAINT "CostingLotConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLotRestoration" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "consumptionId" TEXT NOT NULL,
    "returnReferenceId" TEXT NOT NULL,
    "cycleId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostingLotRestoration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destWarehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "performedBy" TEXT,
    "requestedBy" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptNote" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientKey" TEXT,

    CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptNoteItem" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "purchaseItemId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "acceptedQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "damageResponsibility" TEXT NOT NULL DEFAULT 'supplier',
    "freeOfCharge" BOOLEAN NOT NULL DEFAULT false,
    "lineWarehouseId" TEXT,

    CONSTRAINT "GoodsReceiptNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT,
    "accountId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentInvoice" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,

    CONSTRAINT "SupplierPaymentInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFeedConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "platform" TEXT NOT NULL,
    "secureToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "excludeOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "minPriceFilter" DECIMAL(10,2),
    "googleProductCategory" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeedConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFeedLog" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "platform" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFeedLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageView" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "referrer" TEXT,
    "source" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "sessionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStockCycle" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStockCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemComboComponent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "comboItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "unitQuantity" INTEGER NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "managedStockReserved" BOOLEAN NOT NULL DEFAULT false,
    "managedStockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItemComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentPhysicalReservation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboComponentPhysicalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentPhysicalReservationAllocation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ComboComponentPhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileBuild" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "versionName" TEXT NOT NULL DEFAULT '1.0.0',
    "versionCode" INTEGER NOT NULL DEFAULT 1,
    "artifactPath" TEXT,
    "buildLogUrl" TEXT,
    "triggeredBy" TEXT,
    "triggeredById" TEXT,
    "clientDomain" TEXT,
    "packageId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupJob" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileKey" TEXT,
    "fileSize" BIGINT,
    "checksum" TEXT,
    "dbDumpSize" BIGINT,
    "filesSize" BIGINT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingContext" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "ctxId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "url" TEXT,
    "referrer" TEXT,
    "identifiers" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingSnapshot" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "eventTime" BIGINT NOT NULL,
    "actionSource" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingOutbox" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "TrackingOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingDispatch" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "queueJobId" TEXT,
    "provider" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL DEFAULT 'default',
    "pixelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerEventId" TEXT,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "errorMsg" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "payloadSnapshot" JSONB,
    "adapterVersion" INTEGER,
    "providerApiVersion" TEXT,
    "payloadVersion" INTEGER,
    "normalizerVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingDispatchEvent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "provider" TEXT,
    "queueJobId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "attempt" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingDispatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingReplayArchive" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventTime" BIGINT NOT NULL,
    "archivedPayload" JSONB NOT NULL DEFAULT '{}',
    "configSnapshot" JSONB NOT NULL DEFAULT '{}',
    "versions" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingReplayArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlatform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" "MarketingPlatformSlug" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcePlatform" (
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePlatform_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "MarketingConnection" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "providerUserId" TEXT,
    "providerBusinessId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenType" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "status" "MarketingConnectionStatus" NOT NULL DEFAULT 'connected',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBusiness" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerBusinessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultPaymentAccountId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "providerCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "buyingType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveStatus" TEXT,
    "dailyBudget" DECIMAL(14,2),
    "lifetimeBudget" DECIMAL(14,2),
    "createdTime" TIMESTAMP(3),
    "updatedTime" TIMESTAMP(3),
    "startTime" TIMESTAMP(3),
    "stopTime" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdSet" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "providerAdSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "optimizationGoal" TEXT,
    "billingEvent" TEXT,
    "bidStrategy" TEXT,
    "budget" DECIMAL(14,2),
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAdSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAd" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adSetId" TEXT NOT NULL,
    "providerAdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creativeId" TEXT,
    "creativeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "landingUrl" TEXT,
    "previewUrl" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignInsight" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCampaignInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdSetInsight" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adSetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAdSetInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdInsight" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAdInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFundingEntry" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "adAccountId" TEXT NOT NULL,
    "paymentId" TEXT,
    "fundingType" "MarketingFundingType" NOT NULL DEFAULT 'paid',
    "fundingSource" TEXT NOT NULL,
    "fundingDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currencyAmount" DECIMAL(14,4) NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'BDT',
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "feeAmount" DECIMAL(14,4),
    "taxAmount" DECIMAL(14,4),
    "reference" TEXT,
    "remarks" TEXT,
    "journalEntryId" TEXT,
    "status" "MarketingFundingStatus" NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFundingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPayment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "platformAmount" DECIMAL(14,4) NOT NULL,
    "platformCurrency" TEXT NOT NULL DEFAULT 'USD',
    "actualCost" DECIMAL(14,2),
    "baseCurrency" TEXT NOT NULL DEFAULT 'BDT',
    "effectiveRate" DECIMAL(14,4),
    "feeAmount" DECIMAL(14,4),
    "taxAmount" DECIMAL(14,4),
    "processingFee" DECIMAL(14,4),
    "sourceAccountId" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "status" "MarketingPaymentStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFundingLedger" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "fundingEntryId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "fundingType" "MarketingFundingType" NOT NULL DEFAULT 'paid',
    "receivedAmount" DECIMAL(14,4) NOT NULL,
    "remainingAmount" DECIMAL(14,4) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "consumedAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "MarketingFundingStatus" NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFundingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsumption" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "campaignId" TEXT,
    "orderId" TEXT,
    "consumedAmount" DECIMAL(14,4) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "calculatedCost" DECIMAL(14,2) NOT NULL,
    "spendDate" DATE,
    "source" TEXT NOT NULL DEFAULT 'spend_sync',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSession" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "fbclid" TEXT,
    "clickId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "referrer" TEXT,
    "landingUrl" TEXT,
    "campaignId" TEXT,
    "adSetId" TEXT,
    "adId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sessionId" TEXT,
    "campaignId" TEXT,
    "adSetId" TEXT,
    "adId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "method" "OrderAttributionMethod" NOT NULL,
    "explanation" TEXT,
    "attributionVersion" INTEGER NOT NULL DEFAULT 1,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStaffEvent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStaffEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCostAllocation" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attributionId" TEXT,
    "campaignId" TEXT NOT NULL,
    "allocatedSpend" DECIMAL(14,4) NOT NULL,
    "allocatedCurrency" TEXT NOT NULL DEFAULT '',
    "allocatedRate" DECIMAL(14,4) NOT NULL,
    "allocatedCost" DECIMAL(14,2) NOT NULL,
    "allocationMethod" "MarketingAllocationMethod" NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMarketingCost" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "marketingCost" DECIMAL(14,2) NOT NULL,
    "allocationRatio" DECIMAL(14,6) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMarketingCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSyncStatus" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "stage" TEXT,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditLog" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingRawPayload" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingRawPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDailySummary" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2),
    "marketingCost" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "roas" DECIMAL(14,4),
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDailyProductCost" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2),
    "cost" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "orders" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDailyProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "daysPerYear" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "decisionNote" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBankAccount" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountType" "BankAccountType",
    "routingNumber" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "BankVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "verificationNote" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL DEFAULT 'global',
    "mode" "AttendanceModeSetting" NOT NULL DEFAULT 'APP',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "attendanceMethod" "AttendanceMethod" NOT NULL DEFAULT 'APP',
    "workedMinutes" INTEGER,
    "breakMinutes" INTEGER,
    "scheduledMinutes" INTEGER,
    "overtimeMinutes" INTEGER,
    "lateMinutes" INTEGER,
    "earlyLeaveMinutes" INTEGER,
    "outsideShift" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "source" "AttendanceSessionSource" NOT NULL DEFAULT 'APP',
    "deviceId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAdjustment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayId" TEXT,
    "field" TEXT NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT,
    "reason" TEXT NOT NULL,
    "adjustedById" TEXT,
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "vendor" TEXT,
    "identifier" TEXT,
    "location" TEXT,
    "connectionMethod" TEXT NOT NULL DEFAULT 'API',
    "host" TEXT,
    "port" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncStatus" "AttendanceDeviceSyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "credentialsEncrypted" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEmployeeMapping" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceEmployeeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawAttendanceEvent" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceEmployeeId" TEXT,
    "employeeId" TEXT,
    "eventType" "AttendanceEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AttendanceEventStatus" NOT NULL DEFAULT 'PROCESSED',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawAttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusTransition" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmployeeId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'staff',
    "isFirstForStatus" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRuleV2" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT,
    "purpose" TEXT NOT NULL,
    "amountType" "CommissionAmountType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "valueBasis" TEXT NOT NULL DEFAULT 'order_total',
    "minOrderAmount" DECIMAL(10,2),
    "capPerOrder" DECIMAL(10,2),
    "minimumCount" INTEGER,
    "thresholdPeriod" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRuleV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLedgerV2" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "transitionId" TEXT NOT NULL,
    "actorEmployeeId" TEXT,
    "qualifiedAt" TIMESTAMP(3) NOT NULL,
    "amountType" "CommissionAmountType" NOT NULL,
    "ruleAmount" DECIMAL(10,2) NOT NULL,
    "valueBasis" TEXT NOT NULL,
    "sourceAmount" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "capApplied" BOOLEAN NOT NULL DEFAULT false,
    "minimumCount" INTEGER,
    "thresholdPeriod" TEXT,
    "countAtQualification" INTEGER,
    "periodKey" TEXT NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'approved',
    "payslipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionLedgerV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionThresholdCounter" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "employeeId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastQualifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionThresholdCounter_pkey" PRIMARY KEY ("employeeId","purpose","periodKey")
);

-- CreateTable
CREATE TABLE "CommissionReversalV2" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "refundedAmount" DECIMAL(10,2),
    "reason" TEXT NOT NULL,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReversalV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionReversal" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "commissionEarningId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "refundedAmount" DECIMAL(10,2),
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementInvoice" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "provider" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fileStorageId" TEXT,
    "fileOriginalName" TEXT,
    "fileSha256" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "rawTotals" JSONB,
    "sourceHeaders" JSONB,
    "effectiveTotals" JSONB,
    "isRevision" BOOLEAN NOT NULL DEFAULT false,
    "revisionOfId" TEXT,
    "supersedesInvoiceId" TEXT,
    "state" "CourierSettlementInvoiceState" NOT NULL DEFAULT 'UPLOADED',
    "importProgress" INTEGER NOT NULL DEFAULT 0,
    "importStage" TEXT,
    "finalizingToken" TEXT,
    "finalizingStartedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "journalEntryId" TEXT,
    "accountingStatus" "CourierSettlementAccountingStatus" NOT NULL DEFAULT 'PENDING',
    "accountingError" TEXT,
    "accountingAttemptedAt" TIMESTAMP(3),
    "accountingAttemptedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementRow" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rowClass" "CourierSettlementRowClass" NOT NULL,
    "rowKind" "CourierSettlementRowKind" NOT NULL,
    "consignmentId" TEXT,
    "orderId" TEXT,
    "dispatchId" TEXT,
    "identifier" TEXT,
    "declaredCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredResidual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveResidual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "matchMethod" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "matchContext" JSONB,
    "rawJson" JSONB,
    "normalized" JSONB,
    "hasAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "reviewState" TEXT NOT NULL DEFAULT 'green',
    "supersededByRowId" TEXT,
    "supersededByInvoiceId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementException" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowId" TEXT,
    "orderId" TEXT,
    "dispatchId" TEXT,
    "ruleId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'yellow',
    "status" TEXT NOT NULL DEFAULT 'open',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "context" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementAdjustment" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowId" TEXT,
    "orderId" TEXT,
    "adjustmentClass" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "originalValue" TEXT,
    "adjustedValue" TEXT,
    "difference" DECIMAL(14,2),
    "reason" TEXT,
    "counterpart" TEXT,
    "userId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOfId" TEXT,
    "reversedById" TEXT,

    CONSTRAINT "CourierSettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementActivity" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" "CourierSettlementActivityAction" NOT NULL,
    "actor" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,
    "dedupeKey" TEXT,

    CONSTRAINT "CourierSettlementActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementColumnAlias" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "sourceHeader" TEXT NOT NULL,
    "normalizedHeader" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "origin" "CourierSettlementAliasOrigin" NOT NULL DEFAULT 'LEARNED',
    "ambiguityCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementColumnAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementFinalizationSnapshot" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenById" TEXT,
    "journalEntryId" TEXT,
    "reason" TEXT,
    "totals" JSONB NOT NULL,
    "rows" JSONB NOT NULL,

    CONSTRAINT "CourierSettlementFinalizationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementFinanceRule" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "format" TEXT,
    "netRule" TEXT NOT NULL,
    "chargeComponents" JSONB NOT NULL,
    "residualThreshold" DECIMAL(12,2) NOT NULL DEFAULT 100.0,
    "tolerance" DECIMAL(12,2) NOT NULL DEFAULT 1.0,
    "identifierOrder" JSONB NOT NULL,
    "isPrecedence" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementFinanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementFinanceRuleVersion" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierSettlementFinanceRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantEntitlementCache" (
    "tenant_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEntitlementCache_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_betterAuthUserId_key" ON "User"("betterAuthUserId");

-- CreateIndex
CREATE INDEX "User_tenant_id_role_idx" ON "User"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "User_tenant_id_status_idx" ON "User"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "User_tenant_id_phoneNumber_idx" ON "User"("tenant_id", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenant_id_username_key" ON "User"("tenant_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenant_id_email_key" ON "User"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "better_auth_users_tenant_id_idx" ON "better_auth_users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "better_auth_users_tenant_id_email_key" ON "better_auth_users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_tenant_id_idx" ON "session"("tenant_id");

-- CreateIndex
CREATE INDEX "account_tenant_id_idx" ON "account"("tenant_id");

-- CreateIndex
CREATE INDEX "verification_tenant_id_idx" ON "verification"("tenant_id");

-- CreateIndex
CREATE INDEX "VerificationToken_tenant_id_email_type_idx" ON "VerificationToken"("tenant_id", "email", "type");

-- CreateIndex
CREATE INDEX "VerificationToken_tenant_id_token_type_idx" ON "VerificationToken"("tenant_id", "token", "type");

-- CreateIndex
CREATE INDEX "AccessPreset_tenant_id_idx" ON "AccessPreset"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPreset_tenant_id_name_key" ON "AccessPreset"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "auth_settings_tenant_id_idx" ON "auth_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_settings_tenant_id_providerName_key" ON "auth_settings"("tenant_id", "providerName");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_betterAuthUserId_key" ON "CustomerProfile"("betterAuthUserId");

-- CreateIndex
CREATE INDEX "CustomerProfile_tenant_id_email_idx" ON "CustomerProfile"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "CustomerProfile_name_trgm_idx" ON "CustomerProfile" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_tenant_id_externalId_key" ON "CustomerProfile"("tenant_id", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_tenant_id_phone_key" ON "CustomerProfile"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "CustomerPhone_tenant_id_customerProfileId_idx" ON "CustomerPhone"("tenant_id", "customerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPhone_tenant_id_phone_key" ON "CustomerPhone"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "Task_tenant_id_createdById_idx" ON "Task"("tenant_id", "createdById");

-- CreateIndex
CREATE INDEX "Task_tenant_id_assignee_idx" ON "Task"("tenant_id", "assignee");

-- CreateIndex
CREATE INDEX "Task_tenant_id_assignedEmployeeId_idx" ON "Task"("tenant_id", "assignedEmployeeId");

-- CreateIndex
CREATE INDEX "Task_tenant_id_status_idx" ON "Task"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_tenant_id_displayId_key" ON "Task"("tenant_id", "displayId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_taskId_idx" ON "TaskTimeEntry"("tenant_id", "taskId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_employeeId_idx" ON "TaskTimeEntry"("tenant_id", "employeeId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_startedAt_idx" ON "TaskTimeEntry"("tenant_id", "startedAt");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_employeeId_startedAt_idx" ON "TaskTimeEntry"("tenant_id", "employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_employeeId_startedAt_status_idx" ON "TaskTimeEntry"("tenant_id", "employeeId", "startedAt", "status");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_tenant_id_taskId_employeeId_idx" ON "TaskTimeEntry"("tenant_id", "taskId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UserSettings_tenant_id_idx" ON "UserSettings"("tenant_id");

-- CreateIndex
CREATE INDEX "Address_tenant_id_userId_idx" ON "Address"("tenant_id", "userId");

-- CreateIndex
CREATE INDEX "Address_tenant_id_customerProfileId_idx" ON "Address"("tenant_id", "customerProfileId");

-- CreateIndex
CREATE INDEX "Address_tenant_id_userId_isDefault_createdAt_idx" ON "Address"("tenant_id", "userId", "isDefault", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerAddress_tenant_id_customerProfileId_type_idx" ON "CustomerAddress"("tenant_id", "customerProfileId", "type");

-- CreateIndex
CREATE INDEX "CustomerAddress_tenant_id_customerProfileId_isDefault_idx" ON "CustomerAddress"("tenant_id", "customerProfileId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_customerProfileId_type_normalizedHash_key" ON "CustomerAddress"("customerProfileId", "type", "normalizedHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_tenant_id_userId_idx" ON "RefreshToken"("tenant_id", "userId");

-- CreateIndex
CREATE INDEX "Category_tenant_id_idx" ON "Category"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenant_id_slug_key" ON "Category"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "ProductCategory_tenant_id_categoryId_idx" ON "ProductCategory"("tenant_id", "categoryId");

-- CreateIndex
CREATE INDEX "Brand_tenant_id_idx" ON "Brand"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenant_id_slug_key" ON "Brand"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "Attribute_tenant_id_idx" ON "Attribute"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Attribute_tenant_id_name_key" ON "Attribute"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "AttributeValue_tenant_id_idx" ON "AttributeValue"("tenant_id");

-- CreateIndex
CREATE INDEX "Product_tenant_id_isActive_idx" ON "Product"("tenant_id", "isActive");

-- CreateIndex
CREATE INDEX "Product_tenant_id_categoryId_idx" ON "Product"("tenant_id", "categoryId");

-- CreateIndex
CREATE INDEX "Product_tenant_id_createdAt_idx" ON "Product"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "Product_tenant_id_sku_idx" ON "Product"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "Product_tenant_id_type_idx" ON "Product"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "Product_tenant_id_brandId_idx" ON "Product"("tenant_id", "brandId");

-- CreateIndex
CREATE INDEX "Product_tenant_id_effectivePrice_id_idx" ON "Product"("tenant_id", "effectivePrice", "id");

-- CreateIndex
CREATE INDEX "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_slug_trgm_idx" ON "Product" USING GIN ("slug" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenant_id_slug_key" ON "Product"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "ProductVariant_tenant_id_productId_idx" ON "ProductVariant"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_tenant_id_sku_key" ON "ProductVariant"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "ProductVariantAttributeValue_tenant_id_idx" ON "ProductVariantAttributeValue"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantAttributeValue_variantId_attributeValueId_key" ON "ProductVariantAttributeValue"("variantId", "attributeValueId");

-- CreateIndex
CREATE INDEX "Combo_tenant_id_isActive_idx" ON "Combo"("tenant_id", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Combo_tenant_id_slug_key" ON "Combo"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "ComboItem_tenant_id_idx" ON "ComboItem"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ComboItem_comboId_productId_variantId_key" ON "ComboItem"("comboId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "PosSession_tenant_id_showroomId_idx" ON "PosSession"("tenant_id", "showroomId");

-- CreateIndex
CREATE INDEX "PosSession_tenant_id_cashierId_idx" ON "PosSession"("tenant_id", "cashierId");

-- CreateIndex
CREATE INDEX "PosSession_tenant_id_status_idx" ON "PosSession"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PackingLock_orderId_key" ON "PackingLock"("orderId");

-- CreateIndex
CREATE INDEX "PackingLock_tenant_id_packerId_idx" ON "PackingLock"("tenant_id", "packerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEditLock_orderId_key" ON "OrderEditLock"("orderId");

-- CreateIndex
CREATE INDEX "OrderEditLock_tenant_id_userId_idx" ON "OrderEditLock"("tenant_id", "userId");

-- CreateIndex
CREATE INDEX "OrderEditLock_tenant_id_expiresAt_idx" ON "OrderEditLock"("tenant_id", "expiresAt");

-- CreateIndex
CREATE INDEX "OrderStatus_tenant_id_idx" ON "OrderStatus"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderStatus_tenant_id_name_key" ON "OrderStatus"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_viewToken_key" ON "Order"("viewToken");

-- CreateIndex
CREATE INDEX "Order_tenant_id_exchangeOfOrderId_idx" ON "Order"("tenant_id", "exchangeOfOrderId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_customerId_idx" ON "Order"("tenant_id", "customerId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_statusId_idx" ON "Order"("tenant_id", "statusId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_assignedToId_idx" ON "Order"("tenant_id", "assignedToId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_createdAt_idx" ON "Order"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenant_id_courierService_idx" ON "Order"("tenant_id", "courierService");

-- CreateIndex
CREATE INDEX "Order_tenant_id_courierConsignmentId_idx" ON "Order"("tenant_id", "courierConsignmentId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_courierTrackingCode_idx" ON "Order"("tenant_id", "courierTrackingCode");

-- CreateIndex
CREATE INDEX "Order_tenant_id_paymentOptionType_idx" ON "Order"("tenant_id", "paymentOptionType");

-- CreateIndex
CREATE INDEX "Order_tenant_id_guestPhone_idx" ON "Order"("tenant_id", "guestPhone");

-- CreateIndex
CREATE INDEX "Order_tenant_id_secondaryPhone_idx" ON "Order"("tenant_id", "secondaryPhone");

-- CreateIndex
CREATE INDEX "Order_tenant_id_posSessionId_idx" ON "Order"("tenant_id", "posSessionId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_source_idx" ON "Order"("tenant_id", "source");

-- CreateIndex
CREATE INDEX "Order_tenant_id_salesChannel_idx" ON "Order"("tenant_id", "salesChannel");

-- CreateIndex
CREATE INDEX "Order_tenant_id_channel_idx" ON "Order"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "Order_tenant_id_sourceSlug_idx" ON "Order"("tenant_id", "sourceSlug");

-- CreateIndex
CREATE INDEX "Order_tenant_id_channelMappedAt_idx" ON "Order"("tenant_id", "channelMappedAt");

-- CreateIndex
CREATE INDEX "Order_tenant_id_trackingSessionId_idx" ON "Order"("tenant_id", "trackingSessionId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_trashedAt_idx" ON "Order"("tenant_id", "trashedAt");

-- CreateIndex
CREATE INDEX "Order_tenant_id_ipAddress_idx" ON "Order"("tenant_id", "ipAddress");

-- CreateIndex
CREATE INDEX "Order_tenant_id_kind_idx" ON "Order"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "Order_tenant_id_returnOfOrderId_idx" ON "Order"("tenant_id", "returnOfOrderId");

-- CreateIndex
CREATE INDEX "Order_displayId_trgm_idx" ON "Order" USING GIN ("displayId" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_guestName_trgm_idx" ON "Order" USING GIN ("guestName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenant_id_displayId_key" ON "Order"("tenant_id", "displayId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenant_id_idempotencyKey_key" ON "Order"("tenant_id", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_orderId_idx" ON "OrderItem"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_productId_idx" ON "OrderItem"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_variantId_idx" ON "OrderItem"("tenant_id", "variantId");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_comboId_idx" ON "OrderItem"("tenant_id", "comboId");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_sourceWarehouseId_idx" ON "OrderItem"("tenant_id", "sourceWarehouseId");

-- CreateIndex
CREATE INDEX "OrderItem_tenant_id_sourceOrderItemId_idx" ON "OrderItem"("tenant_id", "sourceOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_journalEntryId_key" ON "Payment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalJournalEntryId_key" ON "Payment"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_orderId_idx" ON "Payment"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_accountId_idx" ON "Payment"("tenant_id", "accountId");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_gatewayCode_idx" ON "Payment"("tenant_id", "gatewayCode");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_transactionId_idx" ON "Payment"("tenant_id", "transactionId");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_sourceOrderId_idx" ON "Payment"("tenant_id", "sourceOrderId");

-- CreateIndex
CREATE INDEX "Payment_tenant_id_sourcePaymentId_idx" ON "Payment"("tenant_id", "sourcePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenant_id_transactionId_gatewayCode_key" ON "Payment"("tenant_id", "transactionId", "gatewayCode");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenant_id_providerPaymentId_key" ON "Payment"("tenant_id", "providerPaymentId");

-- CreateIndex
CREATE INDEX "CodMismatchAlert_tenant_id_orderId_status_idx" ON "CodMismatchAlert"("tenant_id", "orderId", "status");

-- CreateIndex
CREATE INDEX "CodMismatchAlert_tenant_id_consignmentId_idx" ON "CodMismatchAlert"("tenant_id", "consignmentId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_tenant_id_customerId_idx" ON "CustomerCreditEntry"("tenant_id", "customerId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_tenant_id_orderId_idx" ON "CustomerCreditEntry"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_tenant_id_paymentId_idx" ON "CustomerCreditEntry"("tenant_id", "paymentId");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_phone_idx" ON "CheckoutLead"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_status_idx" ON "CheckoutLead"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_assignedToId_idx" ON "CheckoutLead"("tenant_id", "assignedToId");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_lastSeenAt_idx" ON "CheckoutLead"("tenant_id", "lastSeenAt");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_fingerprint_idx" ON "CheckoutLead"("tenant_id", "fingerprint");

-- CreateIndex
CREATE INDEX "CheckoutLead_tenant_id_ctxId_idx" ON "CheckoutLead"("tenant_id", "ctxId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLead_tenant_id_displayId_key" ON "CheckoutLead"("tenant_id", "displayId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_tenant_id_idx" ON "Shipment"("tenant_id");

-- CreateIndex
CREATE INDEX "ShippingOption_tenant_id_idx" ON "ShippingOption"("tenant_id");

-- CreateIndex
CREATE INDEX "ShippingZoneGroup_tenant_id_idx" ON "ShippingZoneGroup"("tenant_id");

-- CreateIndex
CREATE INDEX "EmailTemplate_tenant_id_idx" ON "EmailTemplate"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_tenant_id_name_key" ON "EmailTemplate"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "EmailCampaign_tenant_id_status_idx" ON "EmailCampaign"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "EmailCampaign_tenant_id_createdAt_idx" ON "EmailCampaign"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOption_type_key" ON "PaymentOption"("type");

-- CreateIndex
CREATE INDEX "PaymentGateway_tenant_id_paymentOptionType_idx" ON "PaymentGateway"("tenant_id", "paymentOptionType");

-- CreateIndex
CREATE INDEX "PaymentGateway_tenant_id_accountId_idx" ON "PaymentGateway"("tenant_id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGateway_tenant_id_code_key" ON "PaymentGateway"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "BankAccount_tenant_id_gatewayId_idx" ON "BankAccount"("tenant_id", "gatewayId");

-- CreateIndex
CREATE INDEX "ProductPaymentOption_tenant_id_productId_idx" ON "ProductPaymentOption"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "ProductPaymentOption_tenant_id_comboId_idx" ON "ProductPaymentOption"("tenant_id", "comboId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPaymentOption_productId_comboId_paymentOptionType_key" ON "ProductPaymentOption"("productId", "comboId", "paymentOptionType");

-- CreateIndex
CREATE INDEX "Media_tenant_id_hash_idx" ON "Media"("tenant_id", "hash");

-- CreateIndex
CREATE INDEX "Media_tenant_id_url_idx" ON "Media"("tenant_id", "url");

-- CreateIndex
CREATE INDEX "Media_tenant_id_processingStatus_idx" ON "Media"("tenant_id", "processingStatus");

-- CreateIndex
CREATE INDEX "MediaAttachment_tenant_id_entityType_entityId_idx" ON "MediaAttachment"("tenant_id", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAttachment_mediaId_entityType_entityId_key" ON "MediaAttachment"("mediaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "CourierCredentials_tenant_id_idx" ON "CourierCredentials"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCredentials_tenant_id_courier_key" ON "CourierCredentials"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierCredentialSet_tenant_id_courier_idx" ON "CourierCredentialSet"("tenant_id", "courier");

-- CreateIndex
CREATE UNIQUE INDEX "CourierCredentialSet_tenant_id_courier_label_key" ON "CourierCredentialSet"("tenant_id", "courier", "label");

-- CreateIndex
CREATE INDEX "CourierDispatchLog_tenant_id_orderId_idx" ON "CourierDispatchLog"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "CourierDispatchLog_tenant_id_courier_idx" ON "CourierDispatchLog"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierReportCache_tenant_id_phone_idx" ON "CourierReportCache"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "CourierReportCache_tenant_id_courier_idx" ON "CourierReportCache"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierReportCache_tenant_id_expiresAt_idx" ON "CourierReportCache"("tenant_id", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierReportCache_tenant_id_courier_phone_key" ON "CourierReportCache"("tenant_id", "courier", "phone");

-- CreateIndex
CREATE INDEX "Return_tenant_id_orderId_idx" ON "Return"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "Return_tenant_id_courierReturnId_idx" ON "Return"("tenant_id", "courierReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "Return_tenant_id_displayId_key" ON "Return"("tenant_id", "displayId");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_orderId_idx" ON "Dispatch"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_courierInvoiceRef_idx" ON "Dispatch"("tenant_id", "courierInvoiceRef");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_courier_idx" ON "Dispatch"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_status_idx" ON "Dispatch"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_courierStatus_idx" ON "Dispatch"("tenant_id", "courierStatus");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_lastSyncedAt_idx" ON "Dispatch"("tenant_id", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_consignmentId_idx" ON "Dispatch"("tenant_id", "consignmentId");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_trackingCode_idx" ON "Dispatch"("tenant_id", "trackingCode");

-- CreateIndex
CREATE INDEX "Dispatch_tenant_id_credentialSetId_idx" ON "Dispatch"("tenant_id", "credentialSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_tenant_id_courier_consignmentId_key" ON "Dispatch"("tenant_id", "courier", "consignmentId");

-- CreateIndex
CREATE INDEX "WebhookAttempt_tenant_id_courier_idx" ON "WebhookAttempt"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "WebhookAttempt_tenant_id_receivedAt_idx" ON "WebhookAttempt"("tenant_id", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookAttempt_tenant_id_outcome_idx" ON "WebhookAttempt"("tenant_id", "outcome");

-- CreateIndex
CREATE INDEX "WebhookAttempt_tenant_id_correlationId_idx" ON "WebhookAttempt"("tenant_id", "correlationId");

-- CreateIndex
CREATE INDEX "WebhookAttempt_tenant_id_courier_receivedAt_idx" ON "WebhookAttempt"("tenant_id", "courier", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAttempt_tenant_id_courier_idempotencyKey_key" ON "WebhookAttempt"("tenant_id", "courier", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Coupon_tenant_id_idx" ON "Coupon"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenant_id_code_key" ON "Coupon"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "CouponUsage_tenant_id_couponId_idx" ON "CouponUsage"("tenant_id", "couponId");

-- CreateIndex
CREATE INDEX "CouponUsage_tenant_id_orderId_idx" ON "CouponUsage"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "CouponUsage_tenant_id_userId_idx" ON "CouponUsage"("tenant_id", "userId");

-- CreateIndex
CREATE INDEX "Discount_tenant_id_idx" ON "Discount"("tenant_id");

-- CreateIndex
CREATE INDEX "DiscountApplication_tenant_id_discountId_idx" ON "DiscountApplication"("tenant_id", "discountId");

-- CreateIndex
CREATE INDEX "DiscountApplication_tenant_id_orderId_idx" ON "DiscountApplication"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "Refund_tenant_id_orderId_idx" ON "Refund"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "Refund_tenant_id_exchangeOrderId_idx" ON "Refund"("tenant_id", "exchangeOrderId");

-- CreateIndex
CREATE INDEX "InventoryLog_tenant_id_productId_variantId_createdAt_idx" ON "InventoryLog"("tenant_id", "productId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "PhysicalInventory_tenant_id_productId_idx" ON "PhysicalInventory"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "PhysicalInventory_tenant_id_variantId_idx" ON "PhysicalInventory"("tenant_id", "variantId");

-- CreateIndex
CREATE INDEX "PhysicalInventory_tenant_id_warehouseId_idx" ON "PhysicalInventory"("tenant_id", "warehouseId");

-- CreateIndex
CREATE INDEX "PhysicalInventory_tenant_id_binLocationId_idx" ON "PhysicalInventory"("tenant_id", "binLocationId");

-- CreateIndex
CREATE INDEX "PhysicalInventoryLedger_tenant_id_productId_warehouseId_cre_idx" ON "PhysicalInventoryLedger"("tenant_id", "productId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "PhysicalInventoryLedger_tenant_id_variantId_idx" ON "PhysicalInventoryLedger"("tenant_id", "variantId");

-- CreateIndex
CREATE INDEX "PhysicalReservation_tenant_id_orderId_idx" ON "PhysicalReservation"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "PhysicalReservation_tenant_id_status_idx" ON "PhysicalReservation"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalReservation_orderItemId_cycleId_key" ON "PhysicalReservation"("orderItemId", "cycleId");

-- CreateIndex
CREATE INDEX "PhysicalReservationAllocation_tenant_id_reservationId_idx" ON "PhysicalReservationAllocation"("tenant_id", "reservationId");

-- CreateIndex
CREATE INDEX "PhysicalReservationAllocation_tenant_id_physicalInventoryId_idx" ON "PhysicalReservationAllocation"("tenant_id", "physicalInventoryId");

-- CreateIndex
CREATE INDEX "PhysicalReservationAllocation_tenant_id_binLocationId_idx" ON "PhysicalReservationAllocation"("tenant_id", "binLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalReservationAllocation_reservationId_physicalInvento_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");

-- CreateIndex
CREATE INDEX "ManagedStockLedger_tenant_id_productId_variantId_performedA_idx" ON "ManagedStockLedger"("tenant_id", "productId", "variantId", "performedAt");

-- CreateIndex
CREATE INDEX "ManagedStockLedger_tenant_id_referenceType_referenceId_idx" ON "ManagedStockLedger"("tenant_id", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_tenant_id_status_createdAt_idx" ON "ReconciliationRun"("tenant_id", "status", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_tenant_id_productId_idx" ON "reviews"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "SizeChart_tenant_id_idx" ON "SizeChart"("tenant_id");

-- CreateIndex
CREATE INDEX "CmsPage_tenant_id_isActive_showInFooter_idx" ON "CmsPage"("tenant_id", "isActive", "showInFooter");

-- CreateIndex
CREATE INDEX "CmsPage_tenant_id_type_idx" ON "CmsPage"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_tenant_id_slug_key" ON "CmsPage"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_tenant_id_templateKey_key" ON "CmsPage"("tenant_id", "templateKey");

-- CreateIndex
CREATE INDEX "JobPosting_tenant_id_status_idx" ON "JobPosting"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_tenant_id_slug_key" ON "JobPosting"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "JobApplication_tenant_id_jobPostingId_idx" ON "JobApplication"("tenant_id", "jobPostingId");

-- CreateIndex
CREATE INDEX "JobApplication_tenant_id_status_idx" ON "JobApplication"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "JobApplication_tenant_id_createdAt_idx" ON "JobApplication"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "StoreLocation_tenant_id_isActive_sortOrder_idx" ON "StoreLocation"("tenant_id", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "SupportEnquiry_tenant_id_status_idx" ON "SupportEnquiry"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "SupportEnquiry_tenant_id_createdAt_idx" ON "SupportEnquiry"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "BlockedIp_tenant_id_blockType_isActive_whitelisted_idx" ON "BlockedIp"("tenant_id", "blockType", "isActive", "whitelisted");

-- CreateIndex
CREATE INDEX "BlockedIp_tenant_id_isActive_autoBlocked_idx" ON "BlockedIp"("tenant_id", "isActive", "autoBlocked");

-- CreateIndex
CREATE INDEX "BlockedIp_tenant_id_isActive_expiresAt_idx" ON "BlockedIp"("tenant_id", "isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIp_tenant_id_ip_key" ON "BlockedIp"("tenant_id", "ip");

-- CreateIndex
CREATE INDEX "BlockedPhone_tenant_id_phone_idx" ON "BlockedPhone"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "BlockedPhone_tenant_id_phone_isActive_whitelisted_idx" ON "BlockedPhone"("tenant_id", "phone", "isActive", "whitelisted");

-- CreateIndex
CREATE INDEX "BlockedPhone_tenant_id_isActive_idx" ON "BlockedPhone"("tenant_id", "isActive");

-- CreateIndex
CREATE INDEX "BlockedPhone_tenant_id_isActive_autoBlocked_idx" ON "BlockedPhone"("tenant_id", "isActive", "autoBlocked");

-- CreateIndex
CREATE INDEX "BlockedPhone_tenant_id_isActive_expiresAt_idx" ON "BlockedPhone"("tenant_id", "isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedPhone_tenant_id_phone_key" ON "BlockedPhone"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "BlockSettings_tenant_id_idx" ON "BlockSettings"("tenant_id");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_eventType_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "eventType", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_severity_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "severity", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_category_severity_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "category", "severity", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_ipAddress_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "ipAddress", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_userId_timestamp_idx" ON "SecurityEvent"("tenant_id", "tenant", "userId", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_correlationId_idx" ON "SecurityEvent"("tenant_id", "tenant", "correlationId");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_tenant_parentCorrelationId_idx" ON "SecurityEvent"("tenant_id", "tenant", "parentCorrelationId");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_createdAt_idx" ON "SecurityEvent"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_id_retentionOverride_createdAt_idx" ON "SecurityEvent"("tenant_id", "retentionOverride", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_tenant_id_dedupKey_key" ON "SecurityEvent"("tenant_id", "dedupKey");

-- CreateIndex
CREATE INDEX "SecurityEventHourly_tenant_id_tenant_bucket_idx" ON "SecurityEventHourly"("tenant_id", "tenant", "bucket");

-- CreateIndex
CREATE INDEX "SecurityEventHourly_tenant_id_tenant_bucket_severity_idx" ON "SecurityEventHourly"("tenant_id", "tenant", "bucket", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEventHourly_tenant_bucket_eventType_severity_cate_key" ON "SecurityEventHourly"("tenant", "bucket", "eventType", "severity", "category");

-- CreateIndex
CREATE INDEX "SecurityEventDaily_tenant_id_tenant_date_idx" ON "SecurityEventDaily"("tenant_id", "tenant", "date");

-- CreateIndex
CREATE INDEX "SecurityEventDaily_tenant_id_tenant_date_severity_idx" ON "SecurityEventDaily"("tenant_id", "tenant", "date", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEventDaily_tenant_date_eventType_severity_categor_key" ON "SecurityEventDaily"("tenant", "date", "eventType", "severity", "category");

-- CreateIndex
CREATE INDEX "SecurityBlockDaily_tenant_id_tenant_date_idx" ON "SecurityBlockDaily"("tenant_id", "tenant", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityBlockDaily_tenant_date_blockSource_targetType_key" ON "SecurityBlockDaily"("tenant", "date", "blockSource", "targetType");

-- CreateIndex
CREATE INDEX "SecurityRetentionPolicy_tenant_id_idx" ON "SecurityRetentionPolicy"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityRetentionPolicy_tenant_category_severity_key" ON "SecurityRetentionPolicy"("tenant", "category", "severity");

-- CreateIndex
CREATE INDEX "Tag_tenant_id_idx" ON "Tag"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenant_id_name_key" ON "Tag"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenant_id_slug_key" ON "Tag"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "ProductTag_tenant_id_idx" ON "ProductTag"("tenant_id");

-- CreateIndex
CREATE INDEX "LandingPage_tenant_id_idx" ON "LandingPage"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_tenant_id_slug_key" ON "LandingPage"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "expense_categories_tenant_id_accountId_idx" ON "expense_categories"("tenant_id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenant_id_slug_key" ON "expense_categories"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "Supplier_tenant_id_isActive_idx" ON "Supplier"("tenant_id", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenant_id_slug_key" ON "Supplier"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "Purchase_tenant_id_supplierId_idx" ON "Purchase"("tenant_id", "supplierId");

-- CreateIndex
CREATE INDEX "Purchase_tenant_id_status_idx" ON "Purchase"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Purchase_tenant_id_createdAt_idx" ON "Purchase"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_tenant_id_referenceNo_key" ON "Purchase"("tenant_id", "referenceNo");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenant_id_purchaseId_idx" ON "PurchaseItem"("tenant_id", "purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenant_id_productId_idx" ON "PurchaseItem"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "PurchaseEvent_tenant_id_purchaseId_idx" ON "PurchaseEvent"("tenant_id", "purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseEvent_tenant_id_createdAt_idx" ON "PurchaseEvent"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_journalEntryId_key" ON "Expense"("journalEntryId");

-- CreateIndex
CREATE INDEX "Expense_tenant_id_categoryId_idx" ON "Expense"("tenant_id", "categoryId");

-- CreateIndex
CREATE INDEX "Expense_tenant_id_paymentAccountId_idx" ON "Expense"("tenant_id", "paymentAccountId");

-- CreateIndex
CREATE INDEX "Expense_tenant_id_expenseDate_idx" ON "Expense"("tenant_id", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_tenant_id_createdAt_idx" ON "Expense"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenant_id_sourceType_sourceId_key" ON "Expense"("tenant_id", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "NotificationSetting_tenant_id_idx" ON "NotificationSetting"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_tenant_id_channel_type_key" ON "NotificationSetting"("tenant_id", "channel", "type");

-- CreateIndex
CREATE INDEX "NotificationLog_tenant_id_channel_status_idx" ON "NotificationLog"("tenant_id", "channel", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_tenant_id_recipient_idx" ON "NotificationLog"("tenant_id", "recipient");

-- CreateIndex
CREATE INDEX "NotificationLog_tenant_id_sentAt_idx" ON "NotificationLog"("tenant_id", "sentAt");

-- CreateIndex
CREATE INDEX "Referral_tenant_id_referrerId_idx" ON "Referral"("tenant_id", "referrerId");

-- CreateIndex
CREATE INDEX "Referral_tenant_id_code_idx" ON "Referral"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_tenant_id_code_key" ON "Referral"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "ReferralLead_tenant_id_referralId_idx" ON "ReferralLead"("tenant_id", "referralId");

-- CreateIndex
CREATE INDEX "ReferralLead_tenant_id_phone_idx" ON "ReferralLead"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "ReferralLead_tenant_id_status_idx" ON "ReferralLead"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ReferralReward_tenant_id_referralId_idx" ON "ReferralReward"("tenant_id", "referralId");

-- CreateIndex
CREATE INDEX "Department_tenant_id_idx" ON "Department"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenant_id_name_key" ON "Department"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenant_id_slug_key" ON "Department"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "Designation_tenant_id_idx" ON "Designation"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenant_id_name_key" ON "Designation"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenant_id_slug_key" ON "Designation"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_betterAuthUserId_key" ON "Employee"("betterAuthUserId");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_departmentId_idx" ON "Employee"("tenant_id", "departmentId");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_designationId_idx" ON "Employee"("tenant_id", "designationId");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_accessPresetId_idx" ON "Employee"("tenant_id", "accessPresetId");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_reportingToId_idx" ON "Employee"("tenant_id", "reportingToId");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_status_idx" ON "Employee"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Employee_tenant_id_status_departmentId_idx" ON "Employee"("tenant_id", "status", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenant_id_employeeId_key" ON "Employee"("tenant_id", "employeeId");

-- CreateIndex
CREATE INDEX "SalaryStructure_tenant_id_employeeId_idx" ON "SalaryStructure"("tenant_id", "employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEarning_tenant_id_employeeId_applicableFrom_idx" ON "EmployeeEarning"("tenant_id", "employeeId", "applicableFrom");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_tenant_id_employeeId_applicableFrom_idx" ON "EmployeeDeduction"("tenant_id", "employeeId", "applicableFrom");

-- CreateIndex
CREATE INDEX "CommissionRule_tenant_id_employeeId_isActive_idx" ON "CommissionRule"("tenant_id", "employeeId", "isActive");

-- CreateIndex
CREATE INDEX "CommissionEarning_tenant_id_employeeId_createdAt_idx" ON "CommissionEarning"("tenant_id", "employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEarning_orderId_ruleId_key" ON "CommissionEarning"("orderId", "ruleId");

-- CreateIndex
CREATE INDEX "Payslip_tenant_id_employeeId_idx" ON "Payslip"("tenant_id", "employeeId");

-- CreateIndex
CREATE INDEX "Payslip_tenant_id_status_idx" ON "Payslip"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Payslip_tenant_id_periodStart_periodEnd_idx" ON "Payslip"("tenant_id", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_employeeId_periodKey_key" ON "Payslip"("employeeId", "periodKey");

-- CreateIndex
CREATE INDEX "PayslipItem_tenant_id_payslipId_idx" ON "PayslipItem"("tenant_id", "payslipId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_journalEntryId_key" ON "PayrollPayment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_reversalJournalEntryId_key" ON "PayrollPayment"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "PayrollPayment_tenant_id_payslipId_idx" ON "PayrollPayment"("tenant_id", "payslipId");

-- CreateIndex
CREATE INDEX "PayrollPayment_tenant_id_accountId_idx" ON "PayrollPayment"("tenant_id", "accountId");

-- CreateIndex
CREATE INDEX "EmploymentHistory_tenant_id_employeeId_effectiveFrom_idx" ON "EmploymentHistory"("tenant_id", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WeeklyOff_tenant_id_employeeId_effectiveFrom_idx" ON "WeeklyOff"("tenant_id", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftPreset_tenant_id_isActive_idx" ON "ShiftPreset"("tenant_id", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPreset_tenant_id_name_key" ON "ShiftPreset"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPreset_tenant_id_code_key" ON "ShiftPreset"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "ShiftAssignment_tenant_id_employeeId_effectiveTo_idx" ON "ShiftAssignment"("tenant_id", "employeeId", "effectiveTo");

-- CreateIndex
CREATE INDEX "ShiftAssignment_tenant_id_shiftPresetId_effectiveTo_idx" ON "ShiftAssignment"("tenant_id", "shiftPresetId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_employeeId_dayOfWeek_effectiveFrom_key" ON "ShiftAssignment"("employeeId", "dayOfWeek", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Account_tenant_id_type_idx" ON "Account"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "Account_tenant_id_parentId_idx" ON "Account"("tenant_id", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenant_id_code_key" ON "Account"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "FinancialPeriod_tenant_id_idx" ON "FinancialPeriod"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_tenant_id_startDate_endDate_key" ON "FinancialPeriod"("tenant_id", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "OpeningBalance_tenant_id_periodId_idx" ON "OpeningBalance"("tenant_id", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_accountId_periodId_key" ON "OpeningBalance"("accountId", "periodId");

-- CreateIndex
CREATE INDEX "JournalEntry_tenant_id_periodId_idx" ON "JournalEntry"("tenant_id", "periodId");

-- CreateIndex
CREATE INDEX "JournalEntry_tenant_id_entryDate_idx" ON "JournalEntry"("tenant_id", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenant_id_entryNo_key" ON "JournalEntry"("tenant_id", "entryNo");

-- CreateIndex
CREATE INDEX "JournalEntryLine_tenant_id_entryId_idx" ON "JournalEntryLine"("tenant_id", "entryId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_tenant_id_accountId_idx" ON "JournalEntryLine"("tenant_id", "accountId");

-- CreateIndex
CREATE INDEX "Warehouse_tenant_id_isActive_idx" ON "Warehouse"("tenant_id", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenant_id_slug_key" ON "Warehouse"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "Zone_tenant_id_warehouseId_idx" ON "Zone"("tenant_id", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_warehouseId_name_key" ON "Zone"("warehouseId", "name");

-- CreateIndex
CREATE INDEX "Rack_tenant_id_zoneId_idx" ON "Rack"("tenant_id", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Rack_zoneId_name_key" ON "Rack"("zoneId", "name");

-- CreateIndex
CREATE INDEX "Shelf_tenant_id_rackId_idx" ON "Shelf"("tenant_id", "rackId");

-- CreateIndex
CREATE UNIQUE INDEX "Shelf_rackId_name_key" ON "Shelf"("rackId", "name");

-- CreateIndex
CREATE INDEX "BinLocation_tenant_id_warehouseId_idx" ON "BinLocation"("tenant_id", "warehouseId");

-- CreateIndex
CREATE INDEX "BinLocation_tenant_id_zoneId_idx" ON "BinLocation"("tenant_id", "zoneId");

-- CreateIndex
CREATE INDEX "BinLocation_tenant_id_rackId_idx" ON "BinLocation"("tenant_id", "rackId");

-- CreateIndex
CREATE INDEX "BinLocation_tenant_id_shelfId_idx" ON "BinLocation"("tenant_id", "shelfId");

-- CreateIndex
CREATE UNIQUE INDEX "BinLocation_warehouseId_code_key" ON "BinLocation"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CostingLot_sourceConsumptionId_key" ON "CostingLot"("sourceConsumptionId");

-- CreateIndex
CREATE INDEX "CostingLot_tenant_id_productId_variantId_warehouseId_remain_idx" ON "CostingLot"("tenant_id", "productId", "variantId", "warehouseId", "remainingQty");

-- CreateIndex
CREATE INDEX "CostingLot_tenant_id_purchaseId_idx" ON "CostingLot"("tenant_id", "purchaseId");

-- CreateIndex
CREATE INDEX "CostingLot_tenant_id_warehouseId_idx" ON "CostingLot"("tenant_id", "warehouseId");

-- CreateIndex
CREATE INDEX "CostingLot_tenant_id_transferId_idx" ON "CostingLot"("tenant_id", "transferId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingLot_tenant_id_lotNumber_key" ON "CostingLot"("tenant_id", "lotNumber");

-- CreateIndex
CREATE INDEX "CostingLotConsumption_tenant_id_costingLotId_idx" ON "CostingLotConsumption"("tenant_id", "costingLotId");

-- CreateIndex
CREATE INDEX "CostingLotConsumption_tenant_id_referenceType_referenceId_idx" ON "CostingLotConsumption"("tenant_id", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "CostingLotConsumption_tenant_id_sourceLotId_idx" ON "CostingLotConsumption"("tenant_id", "sourceLotId");

-- CreateIndex
CREATE INDEX "CostingLotConsumption_tenant_id_cycleId_idx" ON "CostingLotConsumption"("tenant_id", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingLotConsumption_referenceType_referenceId_costingLotI_key" ON "CostingLotConsumption"("referenceType", "referenceId", "costingLotId", "type");

-- CreateIndex
CREATE INDEX "CostingLotRestoration_tenant_id_consumptionId_idx" ON "CostingLotRestoration"("tenant_id", "consumptionId");

-- CreateIndex
CREATE INDEX "CostingLotRestoration_tenant_id_returnReferenceId_idx" ON "CostingLotRestoration"("tenant_id", "returnReferenceId");

-- CreateIndex
CREATE INDEX "CostingLotRestoration_tenant_id_cycleId_idx" ON "CostingLotRestoration"("tenant_id", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingLotRestoration_consumptionId_returnReferenceId_key" ON "CostingLotRestoration"("consumptionId", "returnReferenceId");

-- CreateIndex
CREATE INDEX "StockTransfer_tenant_id_sourceWarehouseId_idx" ON "StockTransfer"("tenant_id", "sourceWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_tenant_id_destWarehouseId_idx" ON "StockTransfer"("tenant_id", "destWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_tenant_id_status_idx" ON "StockTransfer"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_tenant_id_orderId_idx" ON "StockTransfer"("tenant_id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_tenant_id_idempotencyKey_key" ON "StockTransfer"("tenant_id", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StockTransferItem_tenant_id_transferId_idx" ON "StockTransferItem"("tenant_id", "transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_tenant_id_productId_idx" ON "StockTransferItem"("tenant_id", "productId");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_tenant_id_idx" ON "GoodsReceiptNote"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptNote_tenant_id_grnNumber_key" ON "GoodsReceiptNote"("tenant_id", "grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptNote_tenant_id_clientKey_key" ON "GoodsReceiptNote"("tenant_id", "clientKey");

-- CreateIndex
CREATE INDEX "GoodsReceiptNoteItem_tenant_id_idx" ON "GoodsReceiptNoteItem"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_journalEntryId_key" ON "SupplierPayment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_reversalJournalEntryId_key" ON "SupplierPayment"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "SupplierPayment_tenant_id_supplierId_idx" ON "SupplierPayment"("tenant_id", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_tenant_id_accountId_idx" ON "SupplierPayment"("tenant_id", "accountId");

-- CreateIndex
CREATE INDEX "SupplierPaymentInvoice_tenant_id_idx" ON "SupplierPaymentInvoice"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentInvoice_tenant_id_invoiceNo_key" ON "SupplierPaymentInvoice"("tenant_id", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFeedConfig_secureToken_key" ON "ProductFeedConfig"("secureToken");

-- CreateIndex
CREATE INDEX "ProductFeedConfig_tenant_id_idx" ON "ProductFeedConfig"("tenant_id");

-- CreateIndex
CREATE INDEX "ProductFeedConfig_tenant_id_secureToken_isActive_idx" ON "ProductFeedConfig"("tenant_id", "secureToken", "isActive");

-- CreateIndex
CREATE INDEX "ProductFeedLog_tenant_id_idx" ON "ProductFeedLog"("tenant_id");

-- CreateIndex
CREATE INDEX "ProductFeedLog_tenant_id_fetchedAt_idx" ON "ProductFeedLog"("tenant_id", "fetchedAt");

-- CreateIndex
CREATE INDEX "PageView_tenant_id_timestamp_sessionId_idx" ON "PageView"("tenant_id", "timestamp", "sessionId");

-- CreateIndex
CREATE INDEX "PageView_tenant_id_source_timestamp_idx" ON "PageView"("tenant_id", "source", "timestamp");

-- CreateIndex
CREATE INDEX "OrderStockCycle_tenant_id_orderId_idx" ON "OrderStockCycle"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "OrderStockCycle_tenant_id_status_idx" ON "OrderStockCycle"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "OrderItemComboComponent_tenant_id_orderItemId_idx" ON "OrderItemComboComponent"("tenant_id", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemComboComponent_orderItemId_comboItemId_key" ON "OrderItemComboComponent"("orderItemId", "comboItemId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservation_tenant_id_orderId_idx" ON "ComboComponentPhysicalReservation"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservation_tenant_id_status_idx" ON "ComboComponentPhysicalReservation"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentPhysicalReservation_componentId_cycleId_key" ON "ComboComponentPhysicalReservation"("componentId", "cycleId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservationAllocation_tenant_id_reser_idx" ON "ComboComponentPhysicalReservationAllocation"("tenant_id", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentPhysicalReservationAllocation_reservationId_p_key" ON "ComboComponentPhysicalReservationAllocation"("reservationId", "physicalInventoryId");

-- CreateIndex
CREATE INDEX "MobileBuild_tenant_id_app_idx" ON "MobileBuild"("tenant_id", "app");

-- CreateIndex
CREATE INDEX "MobileBuild_tenant_id_status_idx" ON "MobileBuild"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MobileBuild_tenant_id_createdAt_idx" ON "MobileBuild"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "BackupJob_tenant_id_status_idx" ON "BackupJob"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "BackupJob_tenant_id_createdAt_idx" ON "BackupJob"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "BackupJob_tenant_id_type_idx" ON "BackupJob"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingContext_ctxId_key" ON "TrackingContext"("ctxId");

-- CreateIndex
CREATE INDEX "TrackingContext_tenant_id_externalId_idx" ON "TrackingContext"("tenant_id", "externalId");

-- CreateIndex
CREATE INDEX "TrackingContext_tenant_id_lastSeenAt_idx" ON "TrackingContext"("tenant_id", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingSnapshot_eventId_key" ON "TrackingSnapshot"("eventId");

-- CreateIndex
CREATE INDEX "TrackingSnapshot_tenant_id_orderId_idx" ON "TrackingSnapshot"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "TrackingSnapshot_tenant_id_eventType_createdAt_idx" ON "TrackingSnapshot"("tenant_id", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingSnapshot_tenant_id_createdAt_idx" ON "TrackingSnapshot"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingSnapshot_tenant_id_orderId_eventType_key" ON "TrackingSnapshot"("tenant_id", "orderId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingOutbox_snapshotId_key" ON "TrackingOutbox"("snapshotId");

-- CreateIndex
CREATE INDEX "TrackingOutbox_tenant_id_status_priority_nextAttemptAt_idx" ON "TrackingOutbox"("tenant_id", "status", "priority", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "TrackingOutbox_tenant_id_createdAt_idx" ON "TrackingOutbox"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_tenant_id_provider_destinationId_status_cr_idx" ON "TrackingDispatch"("tenant_id", "provider", "destinationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_tenant_id_eventId_createdAt_idx" ON "TrackingDispatch"("tenant_id", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_tenant_id_orderId_createdAt_idx" ON "TrackingDispatch"("tenant_id", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_tenant_id_ctxId_idx" ON "TrackingDispatch"("tenant_id", "ctxId");

-- CreateIndex
CREATE INDEX "TrackingDispatch_tenant_id_createdAt_idx" ON "TrackingDispatch"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingDispatch_snapshotId_provider_destinationId_key" ON "TrackingDispatch"("snapshotId", "provider", "destinationId");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_snapshotId_createdAt_idx" ON "TrackingDispatchEvent"("tenant_id", "snapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_provider_toStatus_createdAt_idx" ON "TrackingDispatchEvent"("tenant_id", "provider", "toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_eventId_createdAt_idx" ON "TrackingDispatchEvent"("tenant_id", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_orderId_createdAt_idx" ON "TrackingDispatchEvent"("tenant_id", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_ctxId_idx" ON "TrackingDispatchEvent"("tenant_id", "ctxId");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_tenant_id_createdAt_idx" ON "TrackingDispatchEvent"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingReplayArchive_snapshotId_key" ON "TrackingReplayArchive"("snapshotId");

-- CreateIndex
CREATE INDEX "TrackingReplayArchive_tenant_id_eventId_idx" ON "TrackingReplayArchive"("tenant_id", "eventId");

-- CreateIndex
CREATE INDEX "TrackingReplayArchive_tenant_id_eventType_archivedAt_idx" ON "TrackingReplayArchive"("tenant_id", "eventType", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlatform_slug_key" ON "MarketingPlatform"("slug");

-- CreateIndex
CREATE INDEX "MarketingPlatform_slug_idx" ON "MarketingPlatform"("slug");

-- CreateIndex
CREATE INDEX "SourcePlatform_capabilities_idx" ON "SourcePlatform" USING GIN ("capabilities");

-- CreateIndex
CREATE INDEX "SourcePlatform_enabled_sortOrder_idx" ON "SourcePlatform"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "MarketingConnection_tenant_id_platformId_idx" ON "MarketingConnection"("tenant_id", "platformId");

-- CreateIndex
CREATE INDEX "MarketingConnection_tenant_id_status_idx" ON "MarketingConnection"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MarketingBusiness_tenant_id_connectionId_idx" ON "MarketingBusiness"("tenant_id", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBusiness_tenant_id_providerBusinessId_key" ON "MarketingBusiness"("tenant_id", "providerBusinessId");

-- CreateIndex
CREATE INDEX "AdAccount_tenant_id_connectionId_idx" ON "AdAccount"("tenant_id", "connectionId");

-- CreateIndex
CREATE INDEX "AdAccount_tenant_id_businessId_idx" ON "AdAccount"("tenant_id", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_tenant_id_providerAccountId_key" ON "AdAccount"("tenant_id", "providerAccountId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenant_id_adAccountId_idx" ON "MarketingCampaign"("tenant_id", "adAccountId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenant_id_status_idx" ON "MarketingCampaign"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenant_id_name_idx" ON "MarketingCampaign"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenant_id_providerCampaignId_idx" ON "MarketingCampaign"("tenant_id", "providerCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_tenant_id_providerCampaignId_key" ON "MarketingCampaign"("tenant_id", "providerCampaignId");

-- CreateIndex
CREATE INDEX "MarketingAdSet_tenant_id_campaignId_idx" ON "MarketingAdSet"("tenant_id", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingAdSet_tenant_id_providerAdSetId_idx" ON "MarketingAdSet"("tenant_id", "providerAdSetId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdSet_tenant_id_providerAdSetId_key" ON "MarketingAdSet"("tenant_id", "providerAdSetId");

-- CreateIndex
CREATE INDEX "MarketingAd_tenant_id_adSetId_idx" ON "MarketingAd"("tenant_id", "adSetId");

-- CreateIndex
CREATE INDEX "MarketingAd_tenant_id_providerAdId_idx" ON "MarketingAd"("tenant_id", "providerAdId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAd_tenant_id_providerAdId_key" ON "MarketingAd"("tenant_id", "providerAdId");

-- CreateIndex
CREATE INDEX "MarketingCampaignInsight_tenant_id_date_idx" ON "MarketingCampaignInsight"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignInsight_campaignId_date_key" ON "MarketingCampaignInsight"("campaignId", "date");

-- CreateIndex
CREATE INDEX "MarketingAdSetInsight_tenant_id_date_idx" ON "MarketingAdSetInsight"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdSetInsight_adSetId_date_key" ON "MarketingAdSetInsight"("adSetId", "date");

-- CreateIndex
CREATE INDEX "MarketingAdInsight_tenant_id_date_idx" ON "MarketingAdInsight"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdInsight_adId_date_key" ON "MarketingAdInsight"("adId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingFundingEntry_journalEntryId_key" ON "MarketingFundingEntry"("journalEntryId");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_tenant_id_adAccountId_idx" ON "MarketingFundingEntry"("tenant_id", "adAccountId");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_tenant_id_fundingDate_idx" ON "MarketingFundingEntry"("tenant_id", "fundingDate");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_tenant_id_status_idx" ON "MarketingFundingEntry"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_tenant_id_paymentId_idx" ON "MarketingFundingEntry"("tenant_id", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPayment_journalEntryId_key" ON "MarketingPayment"("journalEntryId");

-- CreateIndex
CREATE INDEX "MarketingPayment_tenant_id_adAccountId_idx" ON "MarketingPayment"("tenant_id", "adAccountId");

-- CreateIndex
CREATE INDEX "MarketingPayment_tenant_id_paymentDate_idx" ON "MarketingPayment"("tenant_id", "paymentDate");

-- CreateIndex
CREATE INDEX "MarketingPayment_tenant_id_status_idx" ON "MarketingPayment"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MarketingPayment_tenant_id_providerPaymentId_idx" ON "MarketingPayment"("tenant_id", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPayment_tenant_id_providerPaymentId_key" ON "MarketingPayment"("tenant_id", "providerPaymentId");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_tenant_id_fundingEntryId_idx" ON "MarketingFundingLedger"("tenant_id", "fundingEntryId");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_tenant_id_adAccountId_idx" ON "MarketingFundingLedger"("tenant_id", "adAccountId");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_tenant_id_status_idx" ON "MarketingFundingLedger"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "MarketingConsumption_tenant_id_ledgerId_idx" ON "MarketingConsumption"("tenant_id", "ledgerId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_tenant_id_campaignId_idx" ON "MarketingConsumption"("tenant_id", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_tenant_id_orderId_idx" ON "MarketingConsumption"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_tenant_id_spendDate_idx" ON "MarketingConsumption"("tenant_id", "spendDate");

-- CreateIndex
CREATE INDEX "MarketingConsumption_tenant_id_allocatedAt_idx" ON "MarketingConsumption"("tenant_id", "allocatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSession_sessionToken_key" ON "MarketingSession"("sessionToken");

-- CreateIndex
CREATE INDEX "MarketingSession_tenant_id_visitorId_idx" ON "MarketingSession"("tenant_id", "visitorId");

-- CreateIndex
CREATE INDEX "MarketingSession_tenant_id_fbclid_idx" ON "MarketingSession"("tenant_id", "fbclid");

-- CreateIndex
CREATE INDEX "MarketingSession_tenant_id_clickId_idx" ON "MarketingSession"("tenant_id", "clickId");

-- CreateIndex
CREATE INDEX "MarketingSession_tenant_id_utmCampaign_idx" ON "MarketingSession"("tenant_id", "utmCampaign");

-- CreateIndex
CREATE INDEX "MarketingSession_tenant_id_createdAt_idx" ON "MarketingSession"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_orderId_key" ON "OrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "OrderAttribution_tenant_id_sessionId_idx" ON "OrderAttribution"("tenant_id", "sessionId");

-- CreateIndex
CREATE INDEX "OrderAttribution_tenant_id_campaignId_idx" ON "OrderAttribution"("tenant_id", "campaignId");

-- CreateIndex
CREATE INDEX "OrderAttribution_tenant_id_adId_idx" ON "OrderAttribution"("tenant_id", "adId");

-- CreateIndex
CREATE INDEX "OrderAttribution_tenant_id_attributedAt_idx" ON "OrderAttribution"("tenant_id", "attributedAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_orderId_idx" ON "OrderStaffEvent"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_employeeId_createdAt_idx" ON "OrderStaffEvent"("tenant_id", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_userId_createdAt_idx" ON "OrderStaffEvent"("tenant_id", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_action_createdAt_idx" ON "OrderStaffEvent"("tenant_id", "action", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_toStatus_createdAt_idx" ON "OrderStaffEvent"("tenant_id", "toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_tenant_id_createdAt_idx" ON "OrderStaffEvent"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingCostAllocation_tenant_id_campaignId_idx" ON "MarketingCostAllocation"("tenant_id", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingCostAllocation_tenant_id_calculatedAt_idx" ON "MarketingCostAllocation"("tenant_id", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCostAllocation_orderId_campaignId_key" ON "MarketingCostAllocation"("orderId", "campaignId");

-- CreateIndex
CREATE INDEX "ProductMarketingCost_tenant_id_allocationId_idx" ON "ProductMarketingCost"("tenant_id", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMarketingCost_orderItemId_allocationId_key" ON "ProductMarketingCost"("orderItemId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSyncStatus_adAccountId_key" ON "MarketingSyncStatus"("adAccountId");

-- CreateIndex
CREATE INDEX "MarketingSyncStatus_tenant_id_idx" ON "MarketingSyncStatus"("tenant_id");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_tenant_id_entityType_entityId_idx" ON "MarketingAuditLog"("tenant_id", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_tenant_id_action_idx" ON "MarketingAuditLog"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_tenant_id_createdAt_idx" ON "MarketingAuditLog"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingRawPayload_tenant_id_objectType_objectId_idx" ON "MarketingRawPayload"("tenant_id", "objectType", "objectId");

-- CreateIndex
CREATE INDEX "MarketingRawPayload_tenant_id_receivedAt_idx" ON "MarketingRawPayload"("tenant_id", "receivedAt");

-- CreateIndex
CREATE INDEX "MarketingDailySummary_tenant_id_date_idx" ON "MarketingDailySummary"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDailySummary_adAccountId_date_key" ON "MarketingDailySummary"("adAccountId", "date");

-- CreateIndex
CREATE INDEX "MarketingDailyProductCost_tenant_id_date_idx" ON "MarketingDailyProductCost"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDailyProductCost_tenant_id_productId_date_key" ON "MarketingDailyProductCost"("tenant_id", "productId", "date");

-- CreateIndex
CREATE INDEX "LeaveType_tenant_id_idx" ON "LeaveType"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenant_id_name_key" ON "LeaveType"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenant_id_code_key" ON "LeaveType"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenant_id_employeeId_startDate_idx" ON "LeaveRequest"("tenant_id", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenant_id_status_idx" ON "LeaveRequest"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenant_id_date_idx" ON "AttendanceRecord"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");

-- CreateIndex
CREATE INDEX "EmployeeBankAccount_tenant_id_employeeId_idx" ON "EmployeeBankAccount"("tenant_id", "employeeId");

-- CreateIndex
CREATE INDEX "AttendanceSettings_tenant_id_idx" ON "AttendanceSettings"("tenant_id");

-- CreateIndex
CREATE INDEX "AttendanceDay_tenant_id_date_idx" ON "AttendanceDay"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "AttendanceDay"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceSession_tenant_id_dayId_idx" ON "AttendanceSession"("tenant_id", "dayId");

-- CreateIndex
CREATE INDEX "AttendanceBreak_tenant_id_sessionId_idx" ON "AttendanceBreak"("tenant_id", "sessionId");

-- CreateIndex
CREATE INDEX "AttendanceAdjustment_tenant_id_employeeId_adjustedAt_idx" ON "AttendanceAdjustment"("tenant_id", "employeeId", "adjustedAt");

-- CreateIndex
CREATE INDEX "AttendanceDevice_tenant_id_idx" ON "AttendanceDevice"("tenant_id");

-- CreateIndex
CREATE INDEX "DeviceEmployeeMapping_tenant_id_idx" ON "DeviceEmployeeMapping"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEmployeeMapping_deviceId_deviceEmployeeId_key" ON "DeviceEmployeeMapping"("deviceId", "deviceEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEmployeeMapping_deviceId_employeeId_key" ON "DeviceEmployeeMapping"("deviceId", "employeeId");

-- CreateIndex
CREATE INDEX "RawAttendanceEvent_tenant_id_status_idx" ON "RawAttendanceEvent"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RawAttendanceEvent_tenant_id_idempotencyKey_key" ON "RawAttendanceEvent"("tenant_id", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderStatusTransition_orderId_occurredAt_idx" ON "OrderStatusTransition"("tenant_id", "orderId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "OrderStatusTransition_orderId_toStatus_occurredAt_idx" ON "OrderStatusTransition"("tenant_id", "orderId", "toStatus", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "OrderStatusTransition_actorEmployeeId_occurredAt_idx" ON "OrderStatusTransition"("tenant_id", "actorEmployeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommissionRuleV2_tenant_id_employeeId_isActive_idx" ON "CommissionRuleV2"("tenant_id", "employeeId", "isActive");

-- CreateIndex
CREATE INDEX "CommissionRuleV2_tenant_id_employeeId_purpose_isActive_idx" ON "CommissionRuleV2"("tenant_id", "employeeId", "purpose", "isActive");

-- CreateIndex
CREATE INDEX "CommissionLedgerV2_tenant_id_employeeId_qualifiedAt_idx" ON "CommissionLedgerV2"("tenant_id", "employeeId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "CommissionLedgerV2_tenant_id_employeeId_purpose_qualifiedAt_idx" ON "CommissionLedgerV2"("tenant_id", "employeeId", "purpose", "qualifiedAt");

-- CreateIndex
CREATE INDEX "CommissionLedgerV2_tenant_id_payslipId_status_qualifiedAt_idx" ON "CommissionLedgerV2"("tenant_id", "payslipId", "status", "qualifiedAt");

-- CreateIndex
CREATE INDEX "CommissionLedgerV2_tenant_id_ruleId_qualifiedAt_idx" ON "CommissionLedgerV2"("tenant_id", "ruleId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "CommissionLedgerV2_periodKey_idx" ON "CommissionLedgerV2"("tenant_id", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionLedgerV2_order_purpose_unique" ON "CommissionLedgerV2"("orderId", "purpose");

-- CreateIndex
CREATE INDEX "CommissionThresholdCounter_periodKey_idx" ON "CommissionThresholdCounter"("tenant_id", "periodKey");

-- CreateIndex
CREATE INDEX "CommissionReversalV2_ledgerId_idx" ON "CommissionReversalV2"("tenant_id", "ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionReversalV2_ledger_order_unique" ON "CommissionReversalV2"("ledgerId", "orderId");

-- CreateIndex
CREATE INDEX "CommissionReversal_tenant_id_commissionEarningId_idx" ON "CommissionReversal"("tenant_id", "commissionEarningId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementInvoice_journalEntryId_key" ON "CourierSettlementInvoice"("journalEntryId");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_state_idx" ON "CourierSettlementInvoice"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_courier_idx" ON "CourierSettlementInvoice"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_finalizedAt_idx" ON "CourierSettlementInvoice"("tenant_id", "finalizedAt");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_displayId_idx" ON "CourierSettlementInvoice"("tenant_id", "displayId");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_fileSha256_idx" ON "CourierSettlementInvoice"("tenant_id", "fileSha256");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_createdAt_idx" ON "CourierSettlementInvoice"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_tenant_id_state_createdAt_idx" ON "CourierSettlementInvoice"("tenant_id", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementInvoice_tenant_id_displayId_key" ON "CourierSettlementInvoice"("tenant_id", "displayId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_invoiceId_idx" ON "CourierSettlementRow"("tenant_id", "invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_orderId_idx" ON "CourierSettlementRow"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_consignmentId_idx" ON "CourierSettlementRow"("tenant_id", "consignmentId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_reviewState_idx" ON "CourierSettlementRow"("tenant_id", "reviewState");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_supersededByRowId_idx" ON "CourierSettlementRow"("tenant_id", "supersededByRowId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_supersededByInvoiceId_idx" ON "CourierSettlementRow"("tenant_id", "supersededByInvoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_rowClass_supersededByRowId_idx" ON "CourierSettlementRow"("tenant_id", "rowClass", "supersededByRowId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_invoiceId_matchMethod_idx" ON "CourierSettlementRow"("tenant_id", "invoiceId", "matchMethod");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_tenant_id_supersededAt_idx" ON "CourierSettlementRow"("tenant_id", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementRow_invoiceId_rowNumber_key" ON "CourierSettlementRow"("invoiceId", "rowNumber");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_invoiceId_idx" ON "CourierSettlementException"("tenant_id", "invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_rowId_idx" ON "CourierSettlementException"("tenant_id", "rowId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_orderId_idx" ON "CourierSettlementException"("tenant_id", "orderId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_status_idx" ON "CourierSettlementException"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_severity_idx" ON "CourierSettlementException"("tenant_id", "severity");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_invoiceId_createdAt_idx" ON "CourierSettlementException"("tenant_id", "invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlementException_tenant_id_severity_status_idx" ON "CourierSettlementException"("tenant_id", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementAdjustment_journalEntryId_key" ON "CourierSettlementAdjustment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementAdjustment_reversalOfId_key" ON "CourierSettlementAdjustment"("reversalOfId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_tenant_id_invoiceId_idx" ON "CourierSettlementAdjustment"("tenant_id", "invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_tenant_id_rowId_idx" ON "CourierSettlementAdjustment"("tenant_id", "rowId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_tenant_id_invoiceId_field_idx" ON "CourierSettlementAdjustment"("tenant_id", "invoiceId", "field");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_tenant_id_invoiceId_idx" ON "CourierSettlementActivity"("tenant_id", "invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_tenant_id_timestamp_idx" ON "CourierSettlementActivity"("tenant_id", "timestamp");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_tenant_id_invoiceId_timestamp_idx" ON "CourierSettlementActivity"("tenant_id", "invoiceId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementActivity_invoiceId_action_dedupeKey_key" ON "CourierSettlementActivity"("invoiceId", "action", "dedupeKey");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_tenant_id_courier_idx" ON "CourierSettlementColumnAlias"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_tenant_id_courier_field_idx" ON "CourierSettlementColumnAlias"("tenant_id", "courier", "field");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_tenant_id_active_idx" ON "CourierSettlementColumnAlias"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementColumnAlias_tenant_id_courier_sourceHeader_key" ON "CourierSettlementColumnAlias"("tenant_id", "courier", "sourceHeader");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinalizationSnapshot_journalEntryId_key" ON "CourierSettlementFinalizationSnapshot"("journalEntryId");

-- CreateIndex
CREATE INDEX "CourierSettlementFinalizationSnapshot_tenant_id_invoiceId_idx" ON "CourierSettlementFinalizationSnapshot"("tenant_id", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinalizationSnapshot_invoiceId_version_key" ON "CourierSettlementFinalizationSnapshot"("invoiceId", "version");

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRule_tenant_id_courier_idx" ON "CourierSettlementFinanceRule"("tenant_id", "courier");

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRule_tenant_id_approved_idx" ON "CourierSettlementFinanceRule"("tenant_id", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinanceRule_tenant_id_courier_format_key" ON "CourierSettlementFinanceRule"("tenant_id", "courier", "format");

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRuleVersion_tenant_id_ruleId_idx" ON "CourierSettlementFinanceRuleVersion"("tenant_id", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinanceRuleVersion_ruleId_version_key" ON "CourierSettlementFinanceRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "UsageCounter_tenant_id_metric_periodStart_idx" ON "UsageCounter"("tenant_id", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_tenant_id_metric_periodStart_key" ON "UsageCounter"("tenant_id", "metric", "periodStart");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "better_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "better_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_betterAuthUserId_fkey" FOREIGN KEY ("betterAuthUserId") REFERENCES "better_auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPhone" ADD CONSTRAINT "CustomerPhone_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_sizeChartId_fkey" FOREIGN KEY ("sizeChartId") REFERENCES "SizeChart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultBinLocationId_fkey" FOREIGN KEY ("defaultBinLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sizeChartId_fkey" FOREIGN KEY ("sizeChartId") REFERENCES "SizeChart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantAttributeValue" ADD CONSTRAINT "ProductVariantAttributeValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantAttributeValue" ADD CONSTRAINT "ProductVariantAttributeValue_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "AttributeValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingLock" ADD CONSTRAINT "PackingLock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingLock" ADD CONSTRAINT "PackingLock_packerId_fkey" FOREIGN KEY ("packerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEditLock" ADD CONSTRAINT "OrderEditLock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEditLock" ADD CONSTRAINT "OrderEditLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentOptionType_fkey" FOREIGN KEY ("paymentOptionType") REFERENCES "PaymentOption"("type") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sourceSlug_fkey" FOREIGN KEY ("sourceSlug") REFERENCES "SourcePlatform"("slug") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_posSessionId_fkey" FOREIGN KEY ("posSessionId") REFERENCES "PosSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_returnOfOrderId_fkey" FOREIGN KEY ("returnOfOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_exchangeOfOrderId_fkey" FOREIGN KEY ("exchangeOfOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "OrderStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodMismatchAlert" ADD CONSTRAINT "CodMismatchAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLead" ADD CONSTRAINT "CheckoutLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLead" ADD CONSTRAINT "CheckoutLead_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLead" ADD CONSTRAINT "CheckoutLead_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_paymentOptionType_fkey" FOREIGN KEY ("paymentOptionType") REFERENCES "PaymentOption"("type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "PaymentGateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPaymentOption" ADD CONSTRAINT "ProductPaymentOption_paymentOptionType_fkey" FOREIGN KEY ("paymentOptionType") REFERENCES "PaymentOption"("type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPaymentOption" ADD CONSTRAINT "ProductPaymentOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPaymentOption" ADD CONSTRAINT "ProductPaymentOption_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAttachment" ADD CONSTRAINT "MediaAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierDispatchLog" ADD CONSTRAINT "CourierDispatchLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_credentialSetId_fkey" FOREIGN KEY ("credentialSetId") REFERENCES "CourierCredentialSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_exchangeOrderId_fkey" FOREIGN KEY ("exchangeOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_physicalInventoryId_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLead" ADD CONSTRAINT "ReferralLead_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLead" ADD CONSTRAINT "ReferralLead_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_accessPresetId_fkey" FOREIGN KEY ("accessPresetId") REFERENCES "AccessPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_betterAuthUserId_fkey" FOREIGN KEY ("betterAuthUserId") REFERENCES "better_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reportingToId_fkey" FOREIGN KEY ("reportingToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_triggerStatusId_fkey" FOREIGN KEY ("triggerStatusId") REFERENCES "OrderStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipItem" ADD CONSTRAINT "PayslipItem_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyOff" ADD CONSTRAINT "WeeklyOff_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyOff" ADD CONSTRAINT "WeeklyOff_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftPresetId_fkey" FOREIGN KEY ("shiftPresetId") REFERENCES "ShiftPreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "Shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceiptNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_sourceConsumptionId_fkey" FOREIGN KEY ("sourceConsumptionId") REFERENCES "CostingLotConsumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_costingLotId_fkey" FOREIGN KEY ("costingLotId") REFERENCES "CostingLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "CostingLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotRestoration" ADD CONSTRAINT "CostingLotRestoration_consumptionId_fkey" FOREIGN KEY ("consumptionId") REFERENCES "CostingLotConsumption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotRestoration" ADD CONSTRAINT "CostingLotRestoration_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destWarehouseId_fkey" FOREIGN KEY ("destWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNoteItem" ADD CONSTRAINT "GoodsReceiptNoteItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceiptNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentInvoice" ADD CONSTRAINT "SupplierPaymentInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStockCycle" ADD CONSTRAINT "OrderStockCycle_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "OrderItemComboComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ComboComponentPhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_physicalInvent_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConnection" ADD CONSTRAINT "MarketingConnection_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "MarketingPlatform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBusiness" ADD CONSTRAINT "MarketingBusiness_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MarketingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MarketingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "MarketingBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSet" ADD CONSTRAINT "MarketingAdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignInsight" ADD CONSTRAINT "MarketingCampaignInsight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSetInsight" ADD CONSTRAINT "MarketingAdSetInsight_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdInsight" ADD CONSTRAINT "MarketingAdInsight_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MarketingPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingLedger" ADD CONSTRAINT "MarketingFundingLedger_fundingEntryId_fkey" FOREIGN KEY ("fundingEntryId") REFERENCES "MarketingFundingEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingLedger" ADD CONSTRAINT "MarketingFundingLedger_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsumption" ADD CONSTRAINT "MarketingConsumption_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "MarketingFundingLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsumption" ADD CONSTRAINT "MarketingConsumption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSession" ADD CONSTRAINT "MarketingSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSession" ADD CONSTRAINT "MarketingSession_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarketingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStaffEvent" ADD CONSTRAINT "OrderStaffEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStaffEvent" ADD CONSTRAINT "OrderStaffEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "OrderAttribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMarketingCost" ADD CONSTRAINT "ProductMarketingCost_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "MarketingCostAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMarketingCost" ADD CONSTRAINT "ProductMarketingCost_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSyncStatus" ADD CONSTRAINT "MarketingSyncStatus_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDailySummary" ADD CONSTRAINT "MarketingDailySummary_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBankAccount" ADD CONSTRAINT "EmployeeBankAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEmployeeMapping" ADD CONSTRAINT "DeviceEmployeeMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEmployeeMapping" ADD CONSTRAINT "DeviceEmployeeMapping_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawAttendanceEvent" ADD CONSTRAINT "RawAttendanceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawAttendanceEvent" ADD CONSTRAINT "RawAttendanceEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusTransition" ADD CONSTRAINT "OrderStatusTransition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusTransition" ADD CONSTRAINT "OrderStatusTransition_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRuleV2" ADD CONSTRAINT "CommissionRuleV2_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerV2" ADD CONSTRAINT "CommissionLedgerV2_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerV2" ADD CONSTRAINT "CommissionLedgerV2_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerV2" ADD CONSTRAINT "CommissionLedgerV2_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRuleV2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerV2" ADD CONSTRAINT "CommissionLedgerV2_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "OrderStatusTransition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerV2" ADD CONSTRAINT "CommissionLedgerV2_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionThresholdCounter" ADD CONSTRAINT "CommissionThresholdCounter_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReversalV2" ADD CONSTRAINT "CommissionReversalV2_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "CommissionLedgerV2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReversal" ADD CONSTRAINT "CommissionReversal_commissionEarningId_fkey" FOREIGN KEY ("commissionEarningId") REFERENCES "CommissionEarning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementInvoice" ADD CONSTRAINT "CourierSettlementInvoice_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementInvoice" ADD CONSTRAINT "CourierSettlementInvoice_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementRow" ADD CONSTRAINT "CourierSettlementRow_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementRow" ADD CONSTRAINT "CourierSettlementRow_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "CourierSettlementRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "CourierSettlementRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementActivity" ADD CONSTRAINT "CourierSettlementActivity_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementFinalizationSnapshot" ADD CONSTRAINT "CourierSettlementFinalizationSnapshot_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementFinanceRuleVersion" ADD CONSTRAINT "CourierSettlementFinanceRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CourierSettlementFinanceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
