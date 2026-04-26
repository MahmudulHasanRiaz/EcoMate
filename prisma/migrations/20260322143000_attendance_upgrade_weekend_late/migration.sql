-- Attendance Upgrade: Staff-Specific Weekends, Late Status, Weekend Bonus

-- Add Late to AttendanceStatus enum
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'Late';

-- Add WeekendBonus to StaffIncomeAction enum
ALTER TYPE "StaffIncomeAction" ADD VALUE IF NOT EXISTS 'WeekendBonus';

-- Add isWeekend and isHoliday to AttendanceRecord
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "isWeekend" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "isHoliday" BOOLEAN NOT NULL DEFAULT false;

-- Add weekendDays (Json?) to StaffMember
ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "weekendDays" JSONB;

-- Add referenceDate to StaffIncome
ALTER TABLE "StaffIncome" ADD COLUMN IF NOT EXISTS "referenceDate" DATE;

-- Add unique index for weekend bonus dedup
CREATE UNIQUE INDEX IF NOT EXISTS "StaffIncome_staffId_action_referenceDate_key" ON "StaffIncome"("staffId", "action", "referenceDate");
