import { PrismaClient } from '@prisma/client';
import { handleStockReservation, handleStockReservationRelease } from '../src/server/modules/stock-reservation';
import { getStockSyncMode } from '../src/server/modules/orders';
import { resolveLocationIdByName, getAvailableQtyAtLocation } from '../src/server/modules/stock-allocation';

const prisma = new PrismaClient();

async function ensurePackingStock(tx: any, order: any, packingId: string) {
  for (const op of order.products) {
    if (op.product?.productType === 'combo') {
      const product = op?.product;
      const comboItems = Array.isArray(product?.comboItems) ? product.comboItems : [];
      const breakdown = Array.isArray(op?.componentBreakdown) ? op.componentBreakdown : [];
      const orderQty = Number(op.quantity || 0);

      const byProductId = new Map<string, any>();
      for (const comp of breakdown) {
        const pid = comp?.productId ? String(comp.productId) : '';
        if (!pid) continue;
        byProductId.set(pid, comp);
      }

      const components: any[] = [];
      for (const ci of comboItems) {
        const childId = String(ci?.child?.id || ci?.childId || '');
        if (!childId) continue;
        const match = byProductId.get(childId);
        const qty = Number(match?.quantity ?? orderQty);
        components.push({
          productId: childId,
          variantId: ci?.variantId || null,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : orderQty,
          sku: match?.sku || ci?.child?.sku,
        });
      }

      // include breakdown items not in comboItems
      for (const comp of breakdown) {
        const pid = comp?.productId ? String(comp.productId) : '';
        if (!pid) continue;
        if (components.some((c) => String(c.productId) === pid)) continue;
        const qty = Number(comp?.quantity ?? orderQty);
        components.push({
          productId: pid,
          variantId: null,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : orderQty,
          sku: comp?.sku,
        });
      }
      
      for (const component of components) {
        const avail = await getAvailableQtyAtLocation(tx, component.productId, component.variantId, packingId);
        if (avail < component.quantity) {
           const sku = component.sku || component.productId;
           throw new Error(`Insufficient stock in Packing Section for combo component ${sku}. Required: ${component.quantity}, Available: ${avail}`);
        }
      }
    } else {
      const avail = await getAvailableQtyAtLocation(tx, op.productId, op.variantId, packingId);
      if (avail < op.quantity) {
         const sku = op.product?.sku || op.sku || op.productId;
         throw new Error(`Insufficient stock in Packing Section for ${sku}. Required: ${op.quantity}, Available: ${avail}`);
      }
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isConfirmed = args.includes('--confirm=BACKFILL_PUBLISH_RESERVES');

  console.log('--- Publish Mode Stock Backfill ---');
  if (!isApply || !isConfirmed) {
    console.log('DRY RUN ACTIVE. No changes will be made.');
    console.log('To apply, use: npx tsx scripts/backfill-publish-reservations.ts --apply --confirm=BACKFILL_PUBLISH_RESERVES');
  }

  const mode = await getStockSyncMode();
  if (mode !== 'publish') {
    console.error('CRITICAL: stockSyncMode is not set to "publish". Operation aborted.');
    process.exit(1);
  }

  const godownId = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Godown', mode: 'insensitive' } } }).then(l => l?.id);
  const packingId = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Packing Section', mode: 'insensitive' } } }).then(l => l?.id);

  if (!godownId || !packingId) {
    console.error(`CRITICAL: locations missing. Godown: ${godownId || 'MISSING'}, Packing: ${packingId || 'MISSING'}`);
    process.exit(1);
  }

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['Confirmed', 'RTS__Ready_to_Ship_'] },
      isStockDeducted: false,
    },
    include: {
      products: { include: { product: { include: { variants: true, comboItems: { include: { child: { include: { variants: true } } } } } } } }
    }
  });

  console.log(`Found ${orders.length} orders matching criteria (Confirmed/RTS and not deducted).\n`);

  let successCount = 0;
  let failCount = 0;

  for (const order of orders) {
    const orderNo = order.orderNumber || order.id;
    console.log(`[Order: ${orderNo}] Status: ${order.status}, isReserved: ${order.isStockReserved}`);

    if (!isApply || !isConfirmed) {
      successCount++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Always release current reservation if it exists (generic or legacy)
        if (order.isStockReserved) {
           // Release legacy cross-lot reservation
           await handleStockReservationRelease(tx, order, 'System_Backfill', null);
        }

        if (order.status === 'Confirmed') {
           // Reserve from Godown
           await handleStockReservation(tx, order, 'System_Backfill', godownId);
           await tx.order.update({ where: { id: order.id }, data: { isStockReserved: true } });
        } else if (order.status === 'RTS__Ready_to_Ship_') {
           // Ensure Packing Stock
           await ensurePackingStock(tx, order, packingId);
           // Reserve in Packing
           await handleStockReservation(tx, order, 'System_Backfill', packingId);
           await tx.order.update({ where: { id: order.id }, data: { isStockReserved: true } });
        }
      }, { timeout: 10000 });
      console.log(`  -> SUCCESS`);
      successCount++;
    } catch (err: any) {
      console.error(`  -> FAILED: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n--- Finished ---');
  console.log(`Processed: ${orders.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
