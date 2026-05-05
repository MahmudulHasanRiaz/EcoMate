-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('Retail', 'Wholesale');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('Retail', 'Wholesaler');

-- CreateEnum
CREATE TYPE "OrderSourcePlatform" AS ENUM ('Manual', 'POS', 'Woo', 'Messenger', 'Facebook', 'WhatsApp', 'TikTok', 'Instagram', 'Website', 'Call', 'SR', 'WholesalerPortal', 'Other');

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'SalesRepresentative';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "type" "CustomerType" NOT NULL DEFAULT 'Retail';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'Retail',
ADD COLUMN     "salesRepresentativeId" TEXT,
ADD COLUMN     "sourcePlatform" "OrderSourcePlatform";

-- CreateIndex
CREATE INDEX "Customer_type_idx" ON "Customer"("type");

-- CreateIndex
CREATE INDEX "Order_channel_status_date_idx" ON "Order"("channel", "status", "date");

-- CreateIndex
CREATE INDEX "Order_channel_date_idx" ON "Order"("channel", "date");

-- CreateIndex
CREATE INDEX "Order_sourcePlatform_idx" ON "Order"("sourcePlatform");

-- CreateIndex
CREATE INDEX "Order_salesRepresentativeId_idx" ON "Order"("salesRepresentativeId");

-- CreateIndex
CREATE INDEX "StaffMember_role_idx" ON "StaffMember"("role");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesRepresentativeId_fkey" FOREIGN KEY ("salesRepresentativeId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
