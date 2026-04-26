-- CreateTable
CREATE TABLE "WooCommerceIntegration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "consumerKey" TEXT NOT NULL,
    "consumerSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WooCommerceIntegration_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "WooCommerceIntegration" ADD CONSTRAINT "WooCommerceIntegration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
