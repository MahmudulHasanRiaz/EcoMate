import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const hasConfirm = args.includes('--confirm=FIX_VARIANT_SKU_SUFFIX');

  if (isApply && !hasConfirm) {
    console.error('Error: To apply changes, you must provide --confirm=FIX_VARIANT_SKU_SUFFIX');
    process.exit(1);
  }

  const productSkuArg = args.find((a) => a.startsWith('--productSku='));
  const productSku = productSkuArg ? productSkuArg.split('=')[1] : undefined;

  console.log(`Starting SKU suffix fix... (Mode: ${isApply ? 'APPLY' : 'DRY RUN'})`);
  if (productSku) {
    console.log(`Filter: productSku=${productSku}`);
  }

  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, productId: true },
  });

  const filtered = variants.filter((v) => /-\d{2}$/.test(v.sku || ''));
  const productId =
    productSku
      ? (await prisma.product.findFirst({ where: { sku: productSku }, select: { id: true } }))?.id
      : undefined;
  const candidates = productId ? filtered.filter((v) => v.productId === productId) : filtered;

  console.log(`Found ${candidates.length} variants with -NN suffix.`);

  let fixCount = 0;
  let conflictCount = 0;

  for (const variant of candidates) {
    const match = variant.sku.match(/(.+)(-\d{2})$/);
    if (!match) continue;

    const baseSku = match[1];
    
    // Check if the base sku already exists (either in Product or ProductVariant)
    const existingProduct = await prisma.product.findFirst({ where: { sku: baseSku } });
    const existingVariant = await prisma.productVariant.findFirst({ where: { sku: baseSku } });

    if (existingProduct || existingVariant) {
      console.log(`[CONFLICT] Cannot revert ${variant.sku} to ${baseSku} because it already exists.`);
      conflictCount++;
      continue;
    }

    console.log(`[FIX] Will rename ${variant.sku} to ${baseSku}`);

    if (isApply) {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { sku: baseSku },
      });
      fixCount++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`Total matched: ${candidates.length}`);
  console.log(`Conflicts skipped: ${conflictCount}`);
  if (isApply) {
    console.log(`Successfully renamed: ${fixCount}`);
  } else {
    console.log(`Would rename: ${candidates.length - conflictCount}`);
    console.log(`\nTo apply, run with: --apply --confirm=FIX_VARIANT_SKU_SUFFIX`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
