-- AlterTable
ALTER TABLE "WooCheckoutLead" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "WooCheckoutLead" ADD COLUMN "assignedByStaffId" TEXT;
ALTER TABLE "WooCheckoutLead" ADD COLUMN "assignedToStaffId" TEXT;

-- CreateIndex
CREATE INDEX "WooCheckoutLead_assignedToStaffId_idx" ON "WooCheckoutLead"("assignedToStaffId");
CREATE INDEX "WooCheckoutLead_status_assignedToStaffId_lastSeenAt_idx" ON "WooCheckoutLead"("status", "assignedToStaffId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_assignedByStaffId_fkey" FOREIGN KEY ("assignedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_assignedToStaffId_fkey" FOREIGN KEY ("assignedToStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;