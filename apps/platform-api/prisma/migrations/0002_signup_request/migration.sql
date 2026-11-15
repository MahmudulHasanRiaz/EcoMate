-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('PENDING_EMAIL', 'VERIFIED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "SignupStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "verificationTokenHash" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupRequest_verificationTokenHash_key" ON "SignupRequest"("verificationTokenHash");

-- CreateIndex
CREATE INDEX "SignupRequest_slug_status_idx" ON "SignupRequest"("slug", "status");

-- CreateIndex
CREATE INDEX "SignupRequest_ownerEmail_status_idx" ON "SignupRequest"("ownerEmail", "status");

-- CreateIndex
CREATE INDEX "SignupRequest_status_createdAt_idx" ON "SignupRequest"("status", "createdAt");
