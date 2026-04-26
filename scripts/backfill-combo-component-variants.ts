import { PrismaClient, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

function stripSkuSuffix(sku: string) {
  const match = sku.match(/(.+)(-\d{2})$/);
  return match ? match[1] : sku;
}

function resolveVariantBySku(variants: any[], sku?: string | null) {
  if (!sku || !Array.isArray(variants) || variants.length === 0) return null;
  const exact = variants.find((v) => v?.sku === sku) || null;
  if (exact) return exact;
  const base = stripSkuSuffix(String(sku));
  if (base && base !== sku) {
    return variants.find((v) => v?.sku === base) || null;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const hasConfirm = args.includes('--confirm=BACKFILL_COMBO_VARIANTS');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const orderIdArg = args.find((a) => a.startsWith('--orderId='));
  const productSkuArg = args.find((a) => a.startsWith('--productSku='));

  if (isApply && !hasConfirm) {
    console.error('Error: To apply changes, you must provide --confirm=BACKFILL_COMBO_VARIANTS');
    process.exit(1);
  }

  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const orderId = orderIdArg ? orderIdArg.split('=')[1] : undefined;
  const productSku = productSkuArg ? productSkuArg.split('=')[1] : undefined;

  console.log(`--- Backfill Combo Component Variants ---`);
  console.log(`Mode: ${isApply ? 'APPLY' : 'DRY RUN'}`);
  if (orderId) console.log(`Filter orderId: ${orderId}`);
  if (productSku) console.log(`Filter productSku: ${productSku}`);
  if (limit) console.log(`Limit: ${limit}`);

  const where: any = {
    componentBreakdown: { not: null },
    product: { productType: ProductType.combo },
  };
  if (orderId) where.orderId = orderId;
  if (productSku) where.product = { ...(where.product || {}), sku: productSku };

  const items = await prisma.orderProduct.findMany({
    where,
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          productType: true,
        },
      },
    },
    take: limit,
  });

  console.log(`Found ${items.length} combo order rows with componentBreakdown.`);

  let updated = 0;
  let skipped = 0;

  for (const op of items) {
    const breakdown = Array.isArray(op.componentBreakdown) ? (op.componentBreakdown as any[]) : [];
    if (breakdown.length === 0) {
      skipped++;
      continue;
    }

    // gather product variants per component productId
    const productIds = Array.from(new Set(breakdown.map((b) => String(b?.productId || '')).filter(Boolean)));
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    let changed = false;
    const next = breakdown.map((comp) => {
      const pid = String(comp?.productId || '');
      if (!pid) return comp;
      const product = productMap.get(pid);
      if (!product || product.productType !== ProductType.variable) return comp;

      if (comp?.variantId) return comp;

      const variants = Array.isArray(product.variants) ? product.variants : [];
      let resolved = resolveVariantBySku(variants, comp?.sku) || null;
      if (!resolved && variants.length === 1) {
        resolved = variants[0];
      }
      if (!resolved) return comp;

      changed = true;
      return {
        ...comp,
        variantId: resolved.id,
        sku: resolved.sku || comp?.sku,
      };
    });

    if (!changed) {
      skipped++;
      continue;
    }

    console.log(`[FIX] orderProduct=${op.id} order=${op.orderId}`);

    if (isApply) {
      await prisma.orderProduct.update({
        where: { id: op.id },
        data: { componentBreakdown: next },
      });
      updated++;
    }
  }

  console.log(`\nSummary`);
  console.log(`Processed: ${items.length}`);
  console.log(`Updated: ${isApply ? updated : 'DRY RUN'}`);
  console.log(`Skipped: ${skipped}`);

  if (!isApply) {
    console.log(`\nTo apply, run with: --apply --confirm=BACKFILL_COMBO_VARIANTS`);
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
