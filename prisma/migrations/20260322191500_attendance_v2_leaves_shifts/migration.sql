-- Attendance v2: Leaves, Shifts, Edit Logs, Overtime
-- Safe additive-only migration

-- 1. New enum: LeaveRequestStatus
DO $$ BEGIN CREATE TYPE "LeaveRequestStatus" AS ENUM ('Pending', 'ManagerApproved', 'AdminApproved', 'Rejected', 'Cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend StaffIncomeAction with OvertimeBonus
ALTER TYPE "StaffIncomeAction" ADD VALUE IF NOT EXISTS 'OvertimeBonus';

-- 3. AttendanceRecord: add overtimeMinutes and leaveRequestId
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "overtimeMinutes" INTEGER;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "leaveRequestId" TEXT;

-- 4. LeaveType table
CREATE TABLE IF NOT EXISTS "LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "annualAllocation" INTEGER NOT NULL DEFAULT 0,
    "maxCarryForward" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveType_name_key" ON "LeaveType"("name");

-- 5. LeaveBalance table
CREATE TABLE IF NOT EXISTS "LeaveBalance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,
    "carried" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveBalance_staffId_leaveTypeId_year_key" ON "LeaveBalance"("staffId", "leaveTypeId", "year");
CREATE INDEX IF NOT EXISTS "LeaveBalance_staffId_idx" ON "LeaveBalance"("staffId");

-- 6. LeaveRequest table
CREATE TABLE IF NOT EXISTS "LeaveRequest" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'Pending',
    "managerApprovedAt" TIMESTAMP(3),
    "adminApprovedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeaveRequest_staffId_idx" ON "LeaveRequest"("staffId");
CREATE INDEX IF NOT EXISTS "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- 7. ShiftTemplate table
CREATE TABLE IF NOT EXISTS "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole",
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "lateGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- 8. StaffShiftOverride table
CREATE TABLE IF NOT EXISTS "StaffShiftOverride" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "lateGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffShiftOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StaffShiftOverride_staffId_idx" ON "StaffShiftOverride"("staffId");

-- 9. AttendanceEditLog table
CREATE TABLE IF NOT EXISTS "AttendanceEditLog" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "oldCheckIn" TIMESTAMP(3),
    "newCheckIn" TIMESTAMP(3),
    "oldCheckOut" TIMESTAMP(3),
    "newCheckOut" TIMESTAMP(3),
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceEditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AttendanceEditLog_attendanceId_idx" ON "AttendanceEditLog"("attendanceId");

-- 10. Foreign keys
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT IF EXISTS "AttendanceRecord_leaveRequestId_fkey";
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AttendanceRecord_leaveRequestId_idx" ON "AttendanceRecord"("leaveRequestId");

ALTER TABLE "LeaveBalance" DROP CONSTRAINT IF EXISTS "LeaveBalance_staffId_fkey";
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaveBalance" DROP CONSTRAINT IF EXISTS "LeaveBalance_leaveTypeId_fkey";
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaveRequest" DROP CONSTRAINT IF EXISTS "LeaveRequest_staffId_fkey";
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaveRequest" DROP CONSTRAINT IF EXISTS "LeaveRequest_leaveTypeId_fkey";
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffShiftOverride" DROP CONSTRAINT IF EXISTS "StaffShiftOverride_staffId_fkey";
ALTER TABLE "StaffShiftOverride" ADD CONSTRAINT "StaffShiftOverride_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceEditLog" DROP CONSTRAINT IF EXISTS "AttendanceEditLog_attendanceId_fkey";
ALTER TABLE "AttendanceEditLog" ADD CONSTRAINT "AttendanceEditLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceEditLog" DROP CONSTRAINT IF EXISTS "AttendanceEditLog_editedById_fkey";
ALTER TABLE "AttendanceEditLog" ADD CONSTRAINT "AttendanceEditLog_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
