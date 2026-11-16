-- CreateTable
CREATE TABLE "TenantLimitOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLimitOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantLimitOverride_key_idx" ON "TenantLimitOverride"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLimitOverride_tenantId_key_key" ON "TenantLimitOverride"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "TenantLimitOverride" ADD CONSTRAINT "TenantLimitOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
