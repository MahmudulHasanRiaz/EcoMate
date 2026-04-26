-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "wholesaleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wholesaleMinQuantity" INTEGER,
ADD COLUMN     "wholesaleNote" TEXT,
ADD COLUMN     "wholesalePackQuantity" INTEGER,
ADD COLUMN     "wholesalePrice" DOUBLE PRECISION,
ADD COLUMN     "wholesaleUnitLabel" TEXT,
ADD COLUMN     "wholesaleVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "wholesaleMinQuantity" INTEGER,
ADD COLUMN     "wholesalePackQuantity" INTEGER,
ADD COLUMN     "wholesalePrice" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Product_wholesaleEnabled_wholesaleVisible_idx" ON "Product"("wholesaleEnabled", "wholesaleVisible");

-- CreateIndex
CREATE INDEX "Product_categoryId_wholesaleEnabled_wholesaleVisible_idx" ON "Product"("categoryId", "wholesaleEnabled", "wholesaleVisible");
