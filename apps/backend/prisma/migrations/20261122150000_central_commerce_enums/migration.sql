-- Central Commerce (Phase 9) — enums, DDL only.
--
-- The 14 new enums for the store/sync/channel models. DDL-only by design:
-- the repo rule forbids enum creation + DML using the new value in one
-- file, and no DML uses these enums anywhere in this port.
--
-- NOTE (pre-existing drift, not introduced here): `prisma migrate dev`
-- also generates ~200 `ALTER TABLE ... ALTER COLUMN "tenant_id" SET
-- DEFAULT ...` statements for the pre-existing tables. Postgres stores the
-- default with '' normalized to ''::text, so the introspected form never
-- textually matches the schema's dbgenerated() string and those ALTERs can
-- never converge — applying them changes nothing. They are stripped from
-- this migration (and from every migration in this set) deliberately.

-- CreateEnum
CREATE TYPE "StoreKind" AS ENUM ('NATIVE', 'WOOCOMMERCE', 'SHOPIFY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'AUTH_FAILED', 'ATTENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "StoreHealthState" AS ENUM ('HEALTHY', 'ATTENTION_REQUIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "StoreAssignmentSource" AS ENUM ('MANUAL', 'RULE');

-- CreateEnum
CREATE TYPE "FieldOwnership" AS ENUM ('ECOMATE', 'EXTERNAL', 'CONFLICT');

-- CreateEnum
CREATE TYPE "OwnershipEvidence" AS ENUM ('PLUGIN', 'INFERRED');

-- CreateEnum
CREATE TYPE "SyncRunScope" AS ENUM ('PRODUCT', 'STOCK', 'ORDER_INGEST', 'ORDER_PUSH', 'RECONCILE', 'MAINTENANCE', 'PUBLISH');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SyncItemStatus" AS ENUM ('PENDING', 'SUCCESS', 'SKIPPED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "SyncObjectType" AS ENUM ('PRODUCT', 'VARIANT', 'CATEGORY', 'MEDIA', 'ORDER', 'PUBLICATION', 'DELETION');

-- CreateEnum
CREATE TYPE "SyncIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SalesChannelType" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('FACEBOOK', 'MESSENGER', 'INSTAGRAM', 'INSTAGRAM_INBOX', 'TIKTOK', 'TIKTOK_INBOX', 'WHATSAPP', 'THREADS', 'OTHER');
