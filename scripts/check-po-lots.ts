import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const args = process.argv.slice(2);
  const poArg = args.find((a) => a.startsWith('--po='));
  if (!poArg) {
    console.error('Usage: npx tsx scripts/check-po-lots.ts --po=010426-08');
    process.exit(1);
  }

  const po = poArg.split('=')[1];
  console.log(`Checking PO Lots for: ${po}\n`);

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: po },
    include: {
      PurchaseOrderItem: {
        include: {
          product: { select: { sku: true, name: true } },
          ProductVariant: { select: { sku: true, name: true } },
        },
      },
    },
  });

  if (!order) {
    console.error(`PO ${po} not found in database.`);
    process.exit(1);
  }

  const inventoryItems = await prisma.inventoryItem.findMany({
    where: {
      lotNumber: {
        startsWith: `PO-${po}`,
        mode: 'insensitive',
      },
    },
  });

  console.log(`Found ${inventoryItems.length} InventoryItem records matching lot PO-${po}%.`);

  const invTotalsMap = new Map<string, number>();
  for (const item of inventoryItems) {
    const key = `${item.productId}-${item.variantId || 'null'}`;
    invTotalsMap.set(key, (invTotalsMap.get(key) || 0) + item.quantity);
  }

  console.log('--- Summary ---');
  let hasMissing = false;

  for (const item of order.PurchaseOrderItem) {
    const key = `${item.productId}-${item.variantId || 'null'}`;
    const name = item.ProductVariant?.name ? `${item.product.name} (${item.ProductVariant.name})` : item.product.name;
    const invQty = invTotalsMap.get(key) || 0;
    const expectedQty = item.receivedQty || 0; // The prompt suggested receivedQty

    const diff = expectedQty - invQty;

    console.log(`${name}`);
    console.log(`  Expected (receivedQty): ${expectedQty}`);
    console.log(`  Actual (InventoryItem sum): ${invQty}`);
    
    if (diff !== 0) {
      console.log(`  Difference: ${diff > 0 ? '-' : '+'}${Math.abs(diff)}`);
      hasMissing = true;
    } else {
      console.log(`  Status: OK`);
    }
    console.log('');
  }

  if (hasMissing) {
    console.log('\nWarning: Some items have missing or excess quantities compared to PO receivedQty.');
  } else {
    console.log('\nSuccess: All items match the expected receivedQty.');
  }
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
