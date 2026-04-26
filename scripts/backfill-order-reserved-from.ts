/**
 * Backfill stockReservedFrom for existing Confirmed orders in publish mode.
 *
 * Logic:
 *   - isStockReserved=true && isStockDeducted=false
 *   - Check if Packing Section has full available qty for all items
 *     → yes: stockReservedFrom = 'packing'
 *     → no:  stockReservedFrom = 'godown'
 *
 * Usage:
 *   npx tsx scripts/backfill-order-reserved-from.ts              # dry run
 *   npx tsx scripts/backfill-order-reserved-from.ts --apply --confirm=BACKFILL_RESERVED_FROM
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resolveLocationId(name: string): Promise<string> {
  const loc = await prisma.stockLocation.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (!loc) throw new Error(`Location "${name}" not found`);
  return loc.id;
}

async function getAvailableQty(productId: string, variantId: string | null, locationId: string): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { productId, variantId, locationId },
    select: { quantity: true, reservedQuantity: true },
  });
  return items.reduce((sum, i) => sum + Math.max((i.quantity ?? 0) - (i.reservedQuantity ?? 0), 0), 0);
}

async function canReserveAllAtLocation(order: any, locationId: string): Promise<boolean> {
  const resolveVariantBySku = (variants: any[], sku?: string | null) => {
    if (!sku || !Array.isArray(variants) || variants.length === 0) return null;
    const exact = variants.find((v: any) => v?.sku === sku) || null;
    if (exact) return exact;
    const base = String(sku).replace(/-\d{2}$/, '');
    if (base && base !== sku) {
      return variants.find((v: any) => v?.sku === base) || null;
    }
    return null;
  };

  for (const op of order.products || []) {
    if (op.product?.productType === 'combo') {
      const comboItems = Array.isArray(op.product?.comboItems) ? op.product.comboItems : [];
      const breakdown = Array.isArray(op.componentBreakdown) ? op.componentBreakdown : [];
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
        const childVariants = Array.isArray(ci?.child?.variants) ? ci.child.variants : [];
        const byId = match?.variantId ? childVariants.find((v: any) => v?.id === match.variantId) || null : null;
        const bySku = !byId ? resolveVariantBySku(childVariants, match?.sku) : null;
        const byCombo = ci?.variant || (ci?.variantId ? childVariants.find((v: any) => v?.id === ci.variantId) || null : null);
        const resolvedVariant = byId || bySku || byCombo || null;
        const resolvedVariantId = resolvedVariant?.id || match?.variantId || ci?.variantId || null;

        components.push({
          productId: childId,
          variantId: resolvedVariantId,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : orderQty,
        });
      }

      for (const comp of breakdown) {
        const pid = comp?.productId ? String(comp.productId) : '';
        if (!pid) continue;
        if (components.some((c: any) => String(c.productId) === pid)) continue;
        const qty = Number(comp?.quantity ?? orderQty);
        components.push({
          productId: pid,
          variantId: comp?.variantId || null,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : orderQty,
        });
      }

      for (const component of components) {
        const avail = await getAvailableQty(component.productId, component.variantId, locationId);
        if (avail < component.quantity) return false;
      }
    } else {
      const avail = await getAvailableQty(op.productId, op.variantId, locationId);
      if (avail < op.quantity) return false;
    }
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const hasConfirm = args.includes('--confirm=BACKFILL_RESERVED_FROM');

  if (isApply && !hasConfirm) {
    console.error('Error: To apply, provide --confirm=BACKFILL_RESERVED_FROM');
    process.exit(1);
  }

  console.log(`\n=== Backfill stockReservedFrom (${isApply ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const packingId = await resolveLocationId('Packing Section');
  console.log(`Packing Section ID: ${packingId}`);

  const orders = await prisma.order.findMany({
    where: {
      isStockReserved: true,
      isStockDeducted: false,
      stockReservedFrom: null,
    },
    include: {
      products: {
        include: {
          product: {
            include: {
              variants: true,
              comboItems: {
                include: { child: { include: { variants: true } } }
              }
            }
          }
        }
      }
    },
  });

  console.log(`Found ${orders.length} orders with isStockReserved=true, isStockDeducted=false, stockReservedFrom=null.\n`);

  let packingCount = 0;
  let godownCount = 0;

  for (const order of orders) {
    const hasPacking = await canReserveAllAtLocation(order, packingId);
    const from = hasPacking ? 'packing' : 'godown';

    console.log(`  ${order.orderNumber || order.id} (status: ${order.status}) → ${from}`);

    if (isApply) {
      await prisma.order.update({
        where: { id: order.id },
        data: { stockReservedFrom: from },
      });
    }

    if (from === 'packing') packingCount++;
    else godownCount++;
  }

  console.log(`\nSummary:`);
  console.log(`  → packing: ${packingCount}`);
  console.log(`  → godown:  ${godownCount}`);
  console.log(`  Total:     ${orders.length}`);

  if (!isApply) {
    console.log(`\nTo apply, run: npx tsx scripts/backfill-order-reserved-from.ts --apply --confirm=BACKFILL_RESERVED_FROM`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
