-- Plan change requests (tenant Subscription hub): a tenant asks to move to
-- a public plan; an operator applies it (via TenantsService.changePlan) or
-- rejects it with a reason. DDL only — one new enum + one new table, no
-- data migration. The single-PENDING-per-tenant rule is enforced in the
-- service (Prisma has no partial-unique-index support).
-- CreateEnum
CREATE TYPE "PlanChangeRequestStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetPlanId" TEXT NOT NULL,
    "targetPlanVersionId" TEXT NOT NULL,
    "status" "PlanChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "rejectionReason" TEXT,
    "requestedBy" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanChangeRequest_tenantId_status_idx" ON "PlanChangeRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PlanChangeRequest_status_createdAt_idx" ON "PlanChangeRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_targetPlanVersionId_fkey" FOREIGN KEY ("targetPlanVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
