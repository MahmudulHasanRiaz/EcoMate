-- AlterEnum: Add ProjectManager and OfficeAssistant to StaffRole enum
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ProjectManager';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'OfficeAssistant';
