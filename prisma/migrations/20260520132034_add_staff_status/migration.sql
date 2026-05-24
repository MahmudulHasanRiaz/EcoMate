-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('Active', 'Terminated');

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "status" "StaffStatus" NOT NULL DEFAULT 'Active';
