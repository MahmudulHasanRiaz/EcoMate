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
