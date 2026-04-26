import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const confirm = args.includes('--confirm=FIX_ANAROS_VARIANT_LINKS');

  const variantSkuArg = args.find((a) => a.startsWith('--variantSku='));
  const lotPrefixArg = args.find((a) => a.startsWith('--lotPrefix='));
  const poArg = args.find((a) => a.startsWith('--po='));
  const useAllInventory = args.includes('--allInventory');

  const targetVariantSku = variantSkuArg
    ? variantSkuArg.split('=')[1]
    : 'TC-ANAROS-COLOR-YELLOWPEST';
  const lotPrefix = lotPrefixArg ? lotPrefixArg.split('=')[1] : 'PO-010426-08';
  const poId = poArg ? poArg.split('=')[1] : '010426-08';

  if (isApply && !confirm) {
    console.error('Add --confirm=FIX_ANAROS_VARIANT_LINKS to apply.');
    process.exit(1);
  }

  const anaros = await prisma.product.findFirst({
    where: { sku: 'TC-ANAROS' },
    include: { variants: true },
  });

  if (!anaros) {
    console.log('TC-ANAROS product not found');
    return;
  }

  console.log(`Found TC-ANAROS (ID: ${anaros.id}), type: ${anaros.productType}`);
  console.log(`Has ${anaros.variants.length} variants`);

  if (anaros.variants.length === 0) {
    console.log('No variants to map to.');
    return;
  }

  const exactMatch = anaros.variants.find((v) => v.sku === targetVariantSku);
  const prefixMatches = anaros.variants.filter((v) =>
    v.sku?.startsWith(`${targetVariantSku}-`),
  );

  if (!exactMatch && prefixMatches.length === 0) {
    console.error(`No variant found for SKU ${targetVariantSku}`);
    console.error('Available variants:');
    anaros.variants.forEach((v) => console.error(`  - ${v.sku}`));
    return;
  }

  if (!exactMatch && prefixMatches.length > 1 && !variantSkuArg) {
    console.error('Multiple variants matched by prefix. Use --variantSku=EXACT_SKU to pick one.');
    prefixMatches.forEach((v) => console.error(`  - ${v.sku}`));
    return;
  }

  const targetVariant = exactMatch || prefixMatches[0];
  if (!targetVariant) return;

  console.log(`Target variant: ${targetVariant.sku} (${targetVariant.id})`);

  const inventoryWhere = useAllInventory
    ? { productId: anaros.id, variantId: null }
    : {
      productId: anaros.id,
      variantId: null,
      lotNumber: { startsWith: lotPrefix, mode: 'insensitive' as const },
    };

  const unlinkedInventory = await prisma.inventoryItem.findMany({
    where: inventoryWhere,
  });

  console.log(`Found ${unlinkedInventory.length} unlinked InventoryItem records.`);
  if (!useAllInventory) {
    console.log(`Inventory filter: lotNumber startsWith "${lotPrefix}"`);
  }

  if (isApply && unlinkedInventory.length > 0) {
    const result = await prisma.inventoryItem.updateMany({
      where: inventoryWhere,
      data: { variantId: targetVariant.id },
    });
    console.log(`Updated ${result.count} inventory items -> variant ${targetVariant.sku}`);
  }

  const unlinkedCombos = await prisma.comboProductItem.findMany({
    where: { childId: anaros.id, variantId: null },
  });

  console.log(`Found ${unlinkedCombos.length} unlinked ComboProductItem records.`);

  if (isApply && unlinkedCombos.length > 0) {
    const result = await prisma.comboProductItem.updateMany({
      where: { childId: anaros.id, variantId: null },
      data: { variantId: targetVariant.id },
    });
    console.log(`Updated ${result.count} combo item links -> variant ${targetVariant.sku}`);
  }

  const unlinkedPOItems = await prisma.purchaseOrderItem.findMany({
    where: { productId: anaros.id, variantId: null, poId },
  });

  console.log(`Found ${unlinkedPOItems.length} unlinked PurchaseOrderItem records for PO ${poId}.`);

  if (isApply && unlinkedPOItems.length > 0) {
    const result = await prisma.purchaseOrderItem.updateMany({
      where: { productId: anaros.id, variantId: null, poId },
      data: { variantId: targetVariant.id },
    });
    console.log(`Updated ${result.count} PO links -> variant ${targetVariant.sku}`);
  }

  console.log('Done.');
}

main().finally(() => prisma.$disconnect());
