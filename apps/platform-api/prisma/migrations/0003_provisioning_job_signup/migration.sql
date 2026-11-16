-- AlterTable
ALTER TABLE "ProvisioningJob" ADD COLUMN "signupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningJob_signupId_key" ON "ProvisioningJob"("signupId");
