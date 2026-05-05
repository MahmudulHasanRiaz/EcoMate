import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiSuccess } from '@/lib/error';

import { enforcePermission } from '@/lib/security';
import { apiForbidden } from '@/lib/error';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { allowed, error } = await enforcePermission('settings', 'update');
  if (!allowed) return error;

  const url = new URL(req.url);
  const apply = url.searchParams.get('apply') === 'true';

  // 1. Get all InventoryItems that have reservedQuantity > 0 OR have active reserve allocations
  const allAllocations = await prisma.orderStockAllocation.groupBy({
    by: ['inventoryItemId'],
    where: { action: 'reserve', quantity: { gt: 0 } },
    _sum: { quantity: true },
  });

  const allocMap = new Map<string, number>();
  for (const row of allAllocations) {
    if (row.inventoryItemId) {
      allocMap.set(row.inventoryItemId, row._sum.quantity || 0);
    }
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
  let overAllocatedFound = 0;
  const changes = [];
  const excessAllocationsRemoved = [];
  const ordersUnreserved = new Set<string>();

  for (const item of itemsWithReserved) {
    totalChecked++;
    const computedReserve = allocMap.get(item.id) || 0;
    const currentReserved = item.reservedQuantity;
    const physicalQty = item.quantity;

    if (computedReserve > physicalQty) {
      overAllocatedFound++;
      // We have more reservations than actual physical stock!
      // We MUST delete the excess allocations to unblock the system.
      const allocations = await prisma.orderStockAllocation.findMany({
        where: { inventoryItemId: item.id, action: 'reserve', quantity: { gt: 0 } },
        orderBy: { createdAt: 'desc' } // Delete newest first
      });

      let remainingAllowed = physicalQty;
      for (const alloc of allocations) {
        if (remainingAllowed >= alloc.quantity) {
          remainingAllowed -= alloc.quantity;
        } else {
          // This allocation doesn't fit in physical stock. We must scrap it.
          if (apply) {
             await prisma.orderStockAllocation.delete({ where: { id: alloc.id } });
             await prisma.order.update({
               where: { id: alloc.orderId },
               data: { isStockReserved: false, stockReservedFrom: null }
             });
          }
          excessAllocationsRemoved.push({
            allocId: alloc.id,
            orderId: alloc.orderId,
            qtyRemoved: alloc.quantity,
          });
          ordersUnreserved.add(alloc.orderId);
        }
      }
      
      // The clamped reserve is now strictly equal to physical quantity
      if (apply) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { reservedQuantity: physicalQty },
        });
        totalFixed++;
      }

      changes.push({
        inventoryItemId: item.id,
        productId: item.productId,
        issue: 'OVER_ALLOCATED',
        physicalQty,
        wasReserved: computedReserve,
        newReserved: physicalQty
      });
      continue;
    }

    // Normal mismatch check
    const clampedReserve = Math.min(computedReserve, physicalQty);
    if (currentReserved !== clampedReserve) {
      totalMismatched++;
      changes.push({
        inventoryItemId: item.id,
        productId: item.productId,
        issue: 'MISMATCH_ONLY',
        lotNumber: item.lotNumber,
        oldReserved: currentReserved,
        newReserved: clampedReserve,
        computedFromAllocations: computedReserve,
        quantity: physicalQty,
      });

      if (apply) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { reservedQuantity: clampedReserve },
        });
        totalFixed++;
      }
    }
  }

  return apiSuccess({
    mode: apply ? 'APPLIED' : 'DRY_RUN (add ?apply=true to URL to apply fixes)',
    totalChecked,
    totalMismatched,
    overAllocatedFound,
    totalFixed,
    ordersUnreservedCount: ordersUnreserved.size,
    changes,
    excessAllocationsRemoved,
  });
}
