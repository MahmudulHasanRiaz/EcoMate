-- Safe script to repair enum drift in production database
-- This script adds missing values to existing ENUM types if they don't already exist.

-- 1. Repair PurchaseOrderStatus
DO $$ BEGIN
    ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PartialReceived';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Repair OrderStatus
DO $$ BEGIN
    ALTER TYPE "OrderStatus" ADD VALUE 'Draft';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "OrderStatus" ADD VALUE 'Damaged';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3. Repair StaffRole
DO $$ BEGIN
    ALTER TYPE "StaffRole" ADD VALUE 'CuttingMan';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "StaffRole" ADD VALUE 'Marketer';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "StaffRole" ADD VALUE 'FinanceManager';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 4. Repair PaymentMethod
DO $$ BEGIN
    ALTER TYPE "PaymentMethod" ADD VALUE 'PaidShippingCOD';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "PaymentMethod" ADD VALUE 'PartialPaidCOD';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "PaymentMethod" ADD VALUE 'Cash';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "PaymentMethod" ADD VALUE 'Bank';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "PaymentMethod" ADD VALUE 'Rocket';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
