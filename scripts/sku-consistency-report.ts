/**
 * SKU Consistency Report Script
 *
 * Usage:
 *   npx tsx scripts/sku-consistency-report.ts
 *
 * What it does (READ-ONLY -- no modifications):
 *   1. Scans all OrderProduct rows and verifies:
 *      - productId references a real Product
 *      - variantId (when set) references a real ProductVariant that belongs to the productId
 *   2. Checks for duplicate Product.sku and ProductVariant.sku values
 *   3. Reports orphaned references, mismatches, and duplicates
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n===============================================');
  console.log('     SKU CONSISTENCY REPORT');
  console.log('===============================================\n');

  // --- 1. Check for duplicate Product SKUs ---

  console.log('-- 1. Duplicate Product SKUs --');
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true },
  });

  const productSkuMap = new Map<string, Array<{ id: string; name: string }>>();
  for (const p of products) {
    const key = p.sku.toLowerCase();
    if (!productSkuMap.has(key)) productSkuMap.set(key, []);
    productSkuMap.get(key)!.push({ id: p.id, name: p.name });
  }

  const duplicateProductSkus = Array.from(productSkuMap.entries()).filter(
    ([, items]) => items.length > 1
  );
  if (duplicateProductSkus.length === 0) {
    console.log('  [OK] No duplicate product SKUs found.\n');
  } else {
    console.log(`  [WARN] ${duplicateProductSkus.length} duplicate SKU(s) found:`);
    for (const [sku, items] of duplicateProductSkus) {
      console.log(`    SKU "${sku}":`);
      for (const item of items) {
        console.log(`      - ${item.id} (${item.name})`);
      }
    }
    console.log('');
  }

  // --- 2. Check for duplicate Variant SKUs ---

  console.log('-- 2. Duplicate Variant SKUs --');
  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, name: true, productId: true },
  });

  const variantSkuMap = new Map<string, Array<{ id: string; name: string; productId: string }>>();
  for (const v of variants) {
    const key = v.sku.toLowerCase();
    if (!variantSkuMap.has(key)) variantSkuMap.set(key, []);
    variantSkuMap.get(key)!.push({ id: v.id, name: v.name, productId: v.productId });
  }

  const duplicateVariantSkus = Array.from(variantSkuMap.entries()).filter(
    ([, items]) => items.length > 1
  );
  if (duplicateVariantSkus.length === 0) {
    console.log('  [OK] No duplicate variant SKUs found.\n');
  } else {
    console.log(`  [WARN] ${duplicateVariantSkus.length} duplicate variant SKU(s) found:`);
    for (const [sku, items] of duplicateVariantSkus) {
      console.log(`    SKU "${sku}":`);
      for (const item of items) {
        console.log(`      - ${item.id} (${item.name}) -> product ${item.productId}`);
      }
    }
    console.log('');
  }

  // --- 3. Build lookup maps for validation ---

  const productIds = new Set(products.map(p => p.id));
  const variantById = new Map(variants.map(v => [v.id, v]));

  // --- 4. Scan OrderProduct references ---

  console.log('-- 3. OrderProduct Reference Integrity --');

  const BATCH = 500;
  let cursor: string | undefined;
  let totalScanned = 0;
  let orphanedProductCount = 0;
  let orphanedVariantCount = 0;
  let variantMismatchCount = 0;
  const orphanedProducts: Array<{ orderId: string; productId: string; variantId: string | null }> = [];
  const orphanedVariants: Array<{ orderId: string; productId: string; variantId: string }> = [];
  const variantMismatches: Array<{ orderId: string; productId: string; variantId: string; actualProductId: string }> = [];

  while (true) {
    const batch = await prisma.orderProduct.findMany({
      select: { id: true, orderId: true, productId: true, variantId: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;
    totalScanned += batch.length;

    for (const op of batch) {
      if (!productIds.has(op.productId)) {
        orphanedProductCount++;
        if (orphanedProducts.length < 20) {
          orphanedProducts.push({ orderId: op.orderId, productId: op.productId, variantId: op.variantId });
        }
        continue;
      }

      if (op.variantId) {
        const variant = variantById.get(op.variantId);
        if (!variant) {
          orphanedVariantCount++;
          if (orphanedVariants.length < 20) {
            orphanedVariants.push({ orderId: op.orderId, productId: op.productId, variantId: op.variantId });
          }
        } else if (variant.productId !== op.productId) {
          variantMismatchCount++;
          if (variantMismatches.length < 20) {
            variantMismatches.push({
              orderId: op.orderId,
              productId: op.productId,
              variantId: op.variantId,
              actualProductId: variant.productId,
            });
          }
        }
      }
    }

    // Simple paging -- exit if batch is smaller than BATCH
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }

  console.log(`  Scanned ${totalScanned} OrderProduct rows.`);

  if (orphanedProductCount === 0 && orphanedVariantCount === 0 && variantMismatchCount === 0) {
    console.log('  [OK] All references are valid.\n');
  } else {
    if (orphanedProductCount > 0) {
      console.log(`  [FAIL] ${orphanedProductCount} orphaned product reference(s) (productId not found):`);
      orphanedProducts.forEach(o => console.log(`      Order ${o.orderId} -> product ${o.productId}`));
      if (orphanedProductCount > 20) console.log(`      ... and ${orphanedProductCount - 20} more`);
    }
    if (orphanedVariantCount > 0) {
      console.log(`  [FAIL] ${orphanedVariantCount} orphaned variant reference(s) (variantId not found):`);
      orphanedVariants.forEach(o => console.log(`      Order ${o.orderId} -> variant ${o.variantId} (product ${o.productId})`));
      if (orphanedVariantCount > 20) console.log(`      ... and ${orphanedVariantCount - 20} more`);
    }
    if (variantMismatchCount > 0) {
      console.log(`  [FAIL] ${variantMismatchCount} variant-product mismatch(es) (variant belongs to different product):`);
      variantMismatches.forEach(o =>
        console.log(`      Order ${o.orderId} -> variant ${o.variantId} expected product ${o.productId}, actual ${o.actualProductId}`)
      );
      if (variantMismatchCount > 20) console.log(`      ... and ${variantMismatchCount - 20} more`);
    }
    console.log('');
  }

  // --- 5. Summary ---

  console.log('===============================================');
  console.log('           SUMMARY');
  console.log('===============================================');
  console.log(`  Products:            ${products.length}`);
  console.log(`  Variants:            ${variants.length}`);
  console.log(`  Duplicate Prod SKUs: ${duplicateProductSkus.length}`);
  console.log(`  Duplicate Var SKUs:  ${duplicateVariantSkus.length}`);
  console.log(`  OrderProducts:       ${totalScanned}`);
  console.log(`  Orphaned Products:   ${orphanedProductCount}`);
  console.log(`  Orphaned Variants:   ${orphanedVariantCount}`);
  console.log(`  Variant Mismatches:  ${variantMismatchCount}`);
  console.log('===============================================\n');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
