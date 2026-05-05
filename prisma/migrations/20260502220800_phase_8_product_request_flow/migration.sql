-- Phase 8: Wholesaler Product Request Flow
-- Additive migration - no destructive changes

-- CreateEnum
CREATE TYPE "ProductRequestStatus" AS ENUM ('Pending', 'Reviewing', 'Sourced', 'Rejected', 'Completed');

-- CreateTable
CREATE TABLE "WholesaleProductRequest" (
    "id" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "description" TEXT NOT NULL,
    "status" "ProductRequestStatus" NOT NULL DEFAULT 'Pending',
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "linkedProductId" TEXT,
    "adminNote" TEXT,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleProductRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WholesaleProductRequest_customerPhone_idx" ON "WholesaleProductRequest"("customerPhone");
CREATE INDEX "WholesaleProductRequest_status_idx" ON "WholesaleProductRequest"("status");
CREATE INDEX "WholesaleProductRequest_createdAt_idx" ON "WholesaleProductRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "WholesaleProductRequest" ADD CONSTRAINT "WholesaleProductRequest_customerPhone_fkey" FOREIGN KEY ("customerPhone") REFERENCES "Customer"("phone") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleProductRequest" ADD CONSTRAINT "WholesaleProductRequest_linkedProductId_fkey" FOREIGN KEY ("linkedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
