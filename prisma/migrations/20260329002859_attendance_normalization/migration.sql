-- AlterTable
ALTER TABLE "AttendanceRecord" 
  ADD COLUMN IF NOT EXISTS "expectedMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "totalInactiveDuration" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overtimeBonusAmount" DOUBLE PRECISION DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AttendanceInactiveRecord" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),

    CONSTRAINT "AttendanceInactiveRecord_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AttendanceEditLog" 
  ADD COLUMN IF NOT EXISTS "oldInactiveDuration" INTEGER,
  ADD COLUMN IF NOT EXISTS "newInactiveDuration" INTEGER,
  ADD COLUMN IF NOT EXISTS "oldOvertimeMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "newOvertimeMinutes" INTEGER;

-- AlterTable
ALTER TABLE "StaffMember" 
  ADD COLUMN IF NOT EXISTS "overtimeEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "overtimeBonusPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceInactiveRecord_attendanceId_fkey') THEN
        ALTER TABLE "AttendanceInactiveRecord" ADD CONSTRAINT "AttendanceInactiveRecord_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
