-- AlterTable
ALTER TABLE "session" ADD COLUMN     "impersonatedBy" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "banExpires" TIMESTAMP(3),
ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "banned" BOOLEAN DEFAULT false,
ADD COLUMN     "role" TEXT;

-- CreateTable
CREATE TABLE "impersonation_handoff" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "adminSessionTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "consumedIp" TEXT,
    "consumedUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "impersonation_handoff_tokenHash_key" ON "impersonation_handoff"("tokenHash");

-- CreateIndex
CREATE INDEX "impersonation_handoff_organizationId_createdAt_idx" ON "impersonation_handoff"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "impersonation_handoff_expiresAt_idx" ON "impersonation_handoff"("expiresAt");
