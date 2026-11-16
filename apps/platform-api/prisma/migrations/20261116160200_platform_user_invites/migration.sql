-- CreateTable
CREATE TABLE "PlatformUserInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PlatformUserRole" NOT NULL DEFAULT 'READONLY',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUserInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUserInvite_tokenHash_key" ON "PlatformUserInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformUserInvite_email_expiresAt_idx" ON "PlatformUserInvite"("email", "expiresAt");

-- AddForeignKey
ALTER TABLE "PlatformUserInvite" ADD CONSTRAINT "PlatformUserInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
