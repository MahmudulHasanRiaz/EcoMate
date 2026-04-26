DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'C2C'
  ) THEN
    ALTER TYPE "OrderStatus" ADD VALUE 'C2C';
  END IF;
END
$$;
