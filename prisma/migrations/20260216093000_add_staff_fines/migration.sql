-- CreateEnum
CREATE TYPE "StaffFineStatus" AS ENUM ('Active', 'Voided');

-- CreateTable
CREATE TABLE "StaffFine" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "StaffFineStatus" NOT NULL DEFAULT 'Active',
    "createdById" TEXT,
    "createdByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffFine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffFine_staffId_date_idx" ON "StaffFine"("staffId", "date");

-- CreateIndex
CREATE INDEX "StaffFine_staffId_status_idx" ON "StaffFine"("staffId", "status");

-- AddForeignKey
ALTER TABLE "StaffFine" ADD CONSTRAINT "StaffFine_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
