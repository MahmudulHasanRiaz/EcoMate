-- Align OpeningWipEntry unique index with prisma/schema.prisma.
-- The previous DB index was stricter and omitted currentStep.

DROP INDEX IF EXISTS "OpeningWipEntry_revisionId_productId_variantId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "OpeningWipEntry_revisionId_productId_variantId_currentStep_key"
  ON "OpeningWipEntry"("revisionId", "productId", "variantId", "currentStep");
