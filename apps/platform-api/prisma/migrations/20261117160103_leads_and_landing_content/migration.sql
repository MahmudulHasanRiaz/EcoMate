-- Leads (public landing lead form) + landing content management (plan §13).
--
-- Lead: contact requests from POST /public/leads, triaged from the console.
-- LandingContent: single flexible model (section, key, locale, value Json)
-- for the manageable landing copy; the landing falls back to built-in
-- content for sections with no active rows.
--
-- Also fixes pre-existing drift: migration 20261116223521 added
-- PlatformRefreshToken.familyId with a DB-level DEFAULT gen_random_uuid()
-- (needed to backfill existing rows), but the schema declares no @default
-- and AuthService.issueTokens always sets familyId explicitly, so the
-- default is dead weight. Dropping it aligns the database with the schema.

-- CreateEnum
CREATE TYPE "LeadContactType" AS ENUM ('email', 'phone');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- DropDefault (drift fix, see header comment)
ALTER TABLE "PlatformRefreshToken" ALTER COLUMN "familyId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "contactType" "LeadContactType" NOT NULL,
    "message" TEXT,
    "monthlyOrders" TEXT,
    "source" TEXT NOT NULL DEFAULT 'landing_page_lead_form',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingContent" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LandingContent_section_locale_sortOrder_idx" ON "LandingContent"("section", "locale", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LandingContent_section_key_locale_key" ON "LandingContent"("section", "key", "locale");
