import { PrismaClient, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

function stripSkuSuffix(sku: string) {
  const match = sku.match(/(.+)(-\d{2})$/);
  return match ? match[1] : sku;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const hasConfirm = args.includes('--confirm=BACKFILL_ORDER_VARIANTS');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const statusesArg = args.find((a) => a.startsWith('--statuses='));
  const productSkuArg = args.find((a) => a.startsWith('--productSku='));

  if (isApply && !hasConfirm) {
    console.error('Error: To apply changes, you must provide --confirm=BACKFILL_ORDER_VARIANTS');
    process.exit(1);
  }

  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const statuses = statusesArg
    ? statusesArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const productSku = productSkuArg ? productSkuArg.split('=')[1] : undefined;

  console.log(`--- Backfill OrderProduct.variantId ---`);
  console.log(`Mode: ${isApply ? 'APPLY' : 'DRY RUN'}`);
  if (statuses) console.log(`Statuses: ${statuses.join(', ')}`);
  if (productSku) console.log(`Filter productSku: ${productSku}`);
  if (limit) console.log(`Limit: ${limit}`);

  const where: any = { variantId: null };
  if (statuses) where.order = { status: { in: statuses } };
  if (productSku) where.product = { sku: productSku };

  const items = await prisma.orderProduct.findMany({
    where,
    include: {
      order: { select: { id: true, status: true } },
      product: { select: { id: true, sku: true, productType: true, variants: { select: { id: true, sku: true } } } },
    },
    take: limit,
  });

  console.log(`Found ${items.length} OrderProduct rows with variantId = null.`);

  let fixed = 0;
  let skipped = 0;

  for (const item of items) {
    const { product, sku } = item;
    if (product.productType !== ProductType.variable) {
      skipped++;
      console.log(`[SKIP] ${item.id} productType=${product.productType}`);
      continue;
    }

    let target = sku
      ? product.variants.find((v) => v.sku === sku)
      : null;

    if (!target && sku) {
      const baseSku = stripSkuSuffix(sku);
      if (baseSku !== sku) {
        target = product.variants.find((v) => v.sku === baseSku) || null;
      }
    }

    if (!target && product.variants.length === 1) {
      target = product.variants[0];
    }

    if (!target) {
      skipped++;
      console.log(`[SKIP] ${item.id} order=${item.orderId} sku=${sku ?? 'null'} (no matching variant)`);
      continue;
    }

    console.log(`[FIX] ${item.id} order=${item.orderId} sku=${sku ?? 'null'} -> variant=${target.sku}`);

    if (isApply) {
      await prisma.orderProduct.update({
        where: { id: item.id },
        data: { variantId: target.id, sku: target.sku },
      });
      fixed++;
    }
  }

  console.log(`\nSummary`);
  console.log(`Processed: ${items.length}`);
  console.log(`Fixed: ${isApply ? fixed : 'DRY RUN'}`);
  console.log(`Skipped: ${skipped}`);

  if (!isApply) {
    console.log(`\nTo apply, run with: --apply --confirm=BACKFILL_ORDER_VARIANTS`);
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
