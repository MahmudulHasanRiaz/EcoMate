/**
 * Repair reservedQuantity drift on InventoryItem records.
 *
 * Default: DRY RUN (prints what would change)
 * Apply:  npx tsx scripts/repair-reserved-quantities-from-allocations.ts --apply --confirm=REPAIR_RESERVED_QTY
 *
 * Logic:
 *   For each InventoryItem, compute sumReserve = SUM(OrderStockAllocation.quantity WHERE inventoryItemId=item.id AND action='reserve')
 *   Set reservedQuantity = min(sumReserve, quantity) (clamp — never exceed physical quantity)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const applyFlag = args.includes('--apply');
  const confirmFlag = args.find(a => a.startsWith('--confirm='));
  const confirmValue = confirmFlag ? confirmFlag.split('=')[1] : '';

  const doApply = applyFlag && confirmValue === 'REPAIR_RESERVED_QTY';

  console.log('=== Repair reservedQuantity from OrderStockAllocations ===');
  console.log(`Mode: ${doApply ? '*** APPLY ***' : 'DRY RUN'}`);
  if (!doApply) {
    console.log('To apply: npx tsx scripts/repair-reserved-quantities-from-allocations.ts --apply --confirm=REPAIR_RESERVED_QTY');
  }
  console.log('');

  // 1. Get all InventoryItems that have reservedQuantity > 0 OR have active reserve allocations
  const allAllocations = await prisma.orderStockAllocation.groupBy({
    by: ['inventoryItemId'],
    where: { action: 'reserve', quantity: { gt: 0 } },
    _sum: { quantity: true },
  });

  const allocMap = new Map<string, number>();
  for (const row of allAllocations) {
    allocMap.set(row.inventoryItemId, row._sum.quantity || 0);
  }

  // Also find items where reservedQuantity > 0 but no allocations exist
  const itemsWithReserved = await prisma.inventoryItem.findMany({
    where: {
      OR: [
        { reservedQuantity: { gt: 0 } },
        { id: { in: Array.from(allocMap.keys()) } },
      ],
    },
    select: {
      id: true,
      productId: true,
      variantId: true,
      locationId: true,
      lotNumber: true,
      quantity: true,
      reservedQuantity: true,
    },
  });

  let totalChecked = 0;
  let totalMismatched = 0;
  let totalFixed = 0;
  const changes: Array<{
    inventoryItemId: string;
    productId: string;
    variantId: string | null;
    lotNumber: string | null;
    oldReserved: number;
    newReserved: number;
    computedFromAllocations: number;
    quantity: number;
  }> = [];

  for (const item of itemsWithReserved) {
    totalChecked++;
    const computedReserve = allocMap.get(item.id) || 0;
    const clampedReserve = Math.min(computedReserve, item.quantity);
    const currentReserved = item.reservedQuantity;

    if (currentReserved !== clampedReserve) {
      totalMismatched++;
      changes.push({
        inventoryItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        lotNumber: item.lotNumber,
        oldReserved: currentReserved,
        newReserved: clampedReserve,
        computedFromAllocations: computedReserve,
        quantity: item.quantity,
      });

      if (doApply) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { reservedQuantity: clampedReserve },
        });
        totalFixed++;
      }
    }
  }

  console.log(`Checked: ${totalChecked} items`);
  console.log(`Mismatched: ${totalMismatched} items`);
  if (doApply) {
    console.log(`Fixed: ${totalFixed} items`);
  }
  console.log('');

  if (changes.length > 0) {
    console.log('Changes:');
    // Show first 50 for brevity
    const display = changes.slice(0, 50);
    console.log(JSON.stringify(display, null, 2));
    if (changes.length > 50) {
      console.log(`  ... and ${changes.length - 50} more`);
    }
  } else {
    console.log('No mismatches found — all reservedQuantity values match allocations.');
  }
}

main()
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
