-- CreateEnum
CREATE TYPE "StoreProvider" AS ENUM ('WOOCOMMERCE', 'SHOPIFY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BindingStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISCONNECTED', 'BLOCKED');

-- CreateTable
CREATE TABLE "TenantExternalStoreBinding" (
    "storeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "StoreProvider" NOT NULL,
    "providerStoreId" TEXT,
    "domainNormalised" TEXT,
    "identityFingerprint" TEXT NOT NULL,
    "status" "BindingStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantExternalStoreBinding_pkey" PRIMARY KEY ("storeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantExternalStoreBinding_identityFingerprint_key" ON "TenantExternalStoreBinding"("identityFingerprint");

-- CreateIndex
CREATE INDEX "TenantExternalStoreBinding_tenantId_idx" ON "TenantExternalStoreBinding"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantExternalStoreBinding_provider_domainNormalised_key" ON "TenantExternalStoreBinding"("provider", "domainNormalised");

-- AddForeignKey
ALTER TABLE "TenantExternalStoreBinding" ADD CONSTRAINT "TenantExternalStoreBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

