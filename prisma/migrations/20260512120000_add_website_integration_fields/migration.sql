-- AlterTable
ALTER TABLE "WooCommerceIntegration" 
  ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'woocommerce',
  ADD COLUMN "callbackUrl" TEXT;

-- Alter consumerKey and consumerSecret to nullable (only required for woo platform)
ALTER TABLE "WooCommerceIntegration" 
  ALTER COLUMN "consumerKey" DROP NOT NULL,
  ALTER COLUMN "consumerSecret" DROP NOT NULL;
