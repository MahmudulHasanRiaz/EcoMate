-- CreateEnum
CREATE TYPE "StaffWorkType" AS ENUM ('Office', 'Remote');

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "workType" "StaffWorkType" NOT NULL DEFAULT 'Remote';
