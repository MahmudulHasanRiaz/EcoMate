import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export interface TransferPayload {
  productId: string;
  variantId?: string | null;
  fromLocationId: string;
  toLocationId: string;
  inventoryItemId: string;
  quantity: number; // positive
  notes?: string;
  user?: string;
}

export async function transferStockLogic(payload: TransferPayload) {
  const { productId, variantId, fromLocationId, toLocationId, inventoryItemId, quantity, notes, user = "System" } = payload;

  if (!productId || !fromLocationId || !toLocationId || !inventoryItemId) {
    throw new Error('Product, lot, and both locations are required.');
  }
  if (fromLocationId === toLocationId) {
    throw new Error('Source and destination cannot be the same.');
  }
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0.');
  }

  return await prisma.$transaction(async (tx) => {
    // SOURCE: must exist and have enough stock
    const src = await tx.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!src || src.quantity < quantity) {
      throw new Error('Insufficient stock in source location.');
    }
    if (src.productId !== productId) {
      throw new Error('Selected lot does not match the product.');
    }
    if ((src.variantId ?? null) !== (variantId ?? null)) {
      throw new Error('Selected lot does not match the variant.');
    }
    if (src.locationId !== fromLocationId) {
      throw new Error('Selected lot does not match the source location.');
    }

    // Decrement source
    const srcUpdated = await tx.inventoryItem.update({
      where: { id: src.id },
      data: { quantity: { decrement: quantity } },
    });

    // DEST: create or increment
    const dst = await tx.inventoryItem.findFirst({
      where: {
        productId: src.productId,
        variantId: src.variantId ?? null,
        locationId: toLocationId,
        lotNumber: src.lotNumber,
      },
    });

    let dstUpdatedId: string;
    let dstBalance: number;

    if (dst) {
      const d = await tx.inventoryItem.update({
        where: { id: dst.id },
        data: { quantity: { increment: quantity } },
      });
      dstUpdatedId = d.id;
      dstBalance = d.quantity;
    } else {
      const d = await tx.inventoryItem.create({
        data: {
          productId: src.productId,
          variantId: src.variantId ?? null,
          locationId: toLocationId,
          quantity,
          lotNumber: src.lotNumber,
          unitCost: src.unitCost,
          receivedDate: new Date(),
        },
      });
      dstUpdatedId = d.id;
      dstBalance = d.quantity;
    }

    // Movement logs — keep enum safe: use 'Adjusted' and encode direction in notes
    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: srcUpdated.id,
        type: 'Adjusted',
        quantityChange: -quantity,
        balance: srcUpdated.quantity,
        notes: `Transfer OUT to ${toLocationId}. ${notes || ''}`.trim(),
        user,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        inventoryItemId: dstUpdatedId,
        type: 'Adjusted',
        quantityChange: +quantity,
        balance: dstBalance,
        notes: `Transfer IN from ${fromLocationId}. ${notes || ''}`.trim(),
        user,
      },
    });
    
    return { srcUpdated, dstUpdatedId };
  });
}

export async function transferGodownStockAggregatedLogic(payload: {
  productId: string;
  variantId?: string | null;
  quantity: number;
}) {
  const { productId, variantId, quantity } = payload;

  if (!productId || quantity <= 0) {
    throw new Error('Valid product and quantity > 0 are required.');
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Resolve Locations
    const godown = await tx.stockLocation.findFirst({
      where: { name: { equals: 'Godown', mode: 'insensitive' } },
    });
    const packing = await tx.stockLocation.findFirst({
      where: { name: { equals: 'Packing Section', mode: 'insensitive' } },
    });

    if (!godown || !packing) {
      throw new Error('Godown or Packing Section location not found.');
    }

    // 2. Fetch Godown lots for this product/variant
    const items = await tx.inventoryItem.findMany({
      where: {
        productId,
        variantId: variantId ?? null,
        locationId: godown.id,
      },
      orderBy: { receivedDate: 'asc' }, // FIFO
    });

    const totalAvailable = items.reduce(
      (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
      0
    );

    if (totalAvailable < quantity) {
      throw new Error(`Insufficient available stock in Godown. Required: ${quantity}, Available: ${totalAvailable}`);
    }

    let remaining = quantity;

    // 3. Process transfers
    for (const src of items) {
      if (remaining <= 0) break;
      
      const available = Math.max(src.quantity - src.reservedQuantity, 0);
      if (available <= 0) continue;

      const deduct = Math.min(available, remaining);

      // Decrement source
      const srcUpdated = await tx.inventoryItem.update({
        where: { id: src.id },
        data: { quantity: { decrement: deduct } },
      });

      // Find or create in destination
      const dst = await tx.inventoryItem.findFirst({
        where: {
          productId: src.productId,
          variantId: src.variantId ?? null,
          locationId: packing.id,
          lotNumber: src.lotNumber,
        },
      });

      let dstUpdatedId: string;
      let dstBalance: number;

      if (dst) {
        const d = await tx.inventoryItem.update({
          where: { id: dst.id },
          data: { quantity: { increment: deduct } },
        });
        dstUpdatedId = d.id;
        dstBalance = d.quantity;
      } else {
        const d = await tx.inventoryItem.create({
          data: {
            productId: src.productId,
            variantId: src.variantId ?? null,
            locationId: packing.id,
            quantity: deduct,
            lotNumber: src.lotNumber,
            unitCost: src.unitCost,
            receivedDate: new Date(),
          },
        });
        dstUpdatedId = d.id;
        dstBalance = d.quantity;
      }

      // Movement logs
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: srcUpdated.id,
          type: 'Adjusted',
          quantityChange: -deduct,
          balance: srcUpdated.quantity,
          notes: `Transfer OUT to Packing Section.`,
          user: 'System', // from bulk action
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: dstUpdatedId,
          type: 'Adjusted',
          quantityChange: +deduct,
          balance: dstBalance,
          notes: `Transfer IN from Godown.`,
          user: 'System', // from bulk action
        },
      });

      remaining -= deduct;
    }
  });
}

export async function transferReservedStockAggregatedLogic(payload: {
  productId: string;
  variantId?: string | null;
  fromLocationId: string;
  quantity: number;
  note?: string;
  user?: string;
}) {
  const { productId, variantId, fromLocationId, quantity, note, user = 'System' } = payload;

  if (!productId || !fromLocationId || quantity <= 0 || !Number.isInteger(quantity)) {
    const error = new Error('Valid product, location, and integer quantity > 0 are required.');
    (error as any).code = 'INVALID_QUANTITY';
    throw error;
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Resolve Locations
    const packing = await tx.stockLocation.findFirst({
      where: { name: { equals: 'Packing Section', mode: 'insensitive' } },
    });

    if (!packing) {
      throw new Error('Packing Section location not found.');
    }

    // Destination is fixed to Packing Section. If the source is already Packing Section, nothing to transfer.
    if (fromLocationId === packing.id) {
      return { success: true, message: 'Source location is Packing Section; no transfer required.' };
    }

    // 2. Fetch Source lots for this product/variant with reservedQuantity > 0 ordered by receivedDate (FIFO)
    const items = await tx.inventoryItem.findMany({
      where: {
        productId,
        variantId: variantId ?? null,
        locationId: fromLocationId,
        reservedQuantity: { gt: 0 }
      },
      orderBy: { receivedDate: 'asc' },
    });

    const totalReserved = items.reduce((sum, item) => sum + item.reservedQuantity, 0);

    if (totalReserved < quantity) {
      const error = new Error(`Insufficient reserved stock. Required: ${quantity}, Reserved: ${totalReserved}`);
      (error as any).code = 'INSUFFICIENT_RESERVED';
      throw error;
    }

    const touchedOrderIds = new Set<string>();
    let remainingToMove = quantity;

    // 3. Process transfers lot by lot
    for (const src of items) {
      if (remainingToMove <= 0) break;
      
      const moveAmount = Math.min(src.reservedQuantity, remainingToMove);
      if (moveAmount <= 0) continue;

      if (src.reservedQuantity < moveAmount || src.quantity < moveAmount) {
        const err: any = new Error(
          `Lot integrity error. lotId=${src.id} lotNumber=${src.lotNumber} ` +
            `qty=${src.quantity} reserved=${src.reservedQuantity} attemptedMove=${moveAmount}`
        );
        err.code = 'LOT_INTEGRITY_ERROR';
        throw err;
      }

      // Decrement source (intentionally update BOTH quantity and reservedQuantity to mirror physical transfer)
      const srcUpdated = await tx.inventoryItem.update({
        where: { id: src.id },
        data: { 
          quantity: { decrement: moveAmount },
          reservedQuantity: { decrement: moveAmount } 
        },
      });

      // Find or create in destination (Packing Section)
      const dst = await tx.inventoryItem.findFirst({
        where: {
          productId: src.productId,
          variantId: src.variantId ?? null,
          locationId: packing.id,
          lotNumber: src.lotNumber,
        },
      });

      let dstUpdatedId: string;
      let dstBalance: number;

      if (dst) {
        const d = await tx.inventoryItem.update({
          where: { id: dst.id },
          data: { 
            quantity: { increment: moveAmount },
            reservedQuantity: { increment: moveAmount }
          },
        });
        dstUpdatedId = d.id;
        dstBalance = d.quantity;
      } else {
        const d = await tx.inventoryItem.create({
          data: {
            productId: src.productId,
            variantId: src.variantId ?? null,
            locationId: packing.id,
            quantity: moveAmount,
            reservedQuantity: moveAmount,
            lotNumber: src.lotNumber,
            unitCost: src.unitCost,
            // Preserve receivedDate so FIFO/aging remains consistent after transfers
            receivedDate: src.receivedDate,
          },
        });
        dstUpdatedId = d.id;
        dstBalance = d.quantity;
      }

      // 4. Update OrderStockAllocation logic (split if needed)
      // Find allocations tracking this specific src item
      const allocations = await tx.orderStockAllocation.findMany({
        where: {
          inventoryItemId: src.id,
          action: 'reserve',
          quantity: { gt: 0 }
        },
        orderBy: { createdAt: 'asc' }
      });

      const allocTotal = allocations.reduce((sum, a) => sum + (a.quantity || 0), 0);
      if (allocTotal < moveAmount) {
        const err: any = new Error(
          `Reservation allocation mismatch for lotId=${src.id} lotNumber=${src.lotNumber}. ` +
            `Need to move ${moveAmount} reserved units, but only ${allocTotal} units are linked via OrderStockAllocation. ` +
            `Run the reservation/repair scripts first to reconcile allocations.`
        );
        err.code = 'ALLOCATIONS_MISSING';
        throw err;
      }

      let allocToMove = moveAmount;
      for (const alloc of allocations) {
        if (allocToMove <= 0) break;

        const assignAmount = Math.min(alloc.quantity, allocToMove);
        
        if (assignAmount === alloc.quantity) {
          // Full allocation move
          await tx.orderStockAllocation.update({
            where: { id: alloc.id },
            data: { inventoryItemId: dstUpdatedId }
          });
          touchedOrderIds.add(alloc.orderId);
        } else {
          // Partial move - Split
          const newOldQty = alloc.quantity - assignAmount;
          const newOldTotal = newOldQty * alloc.unitCost;
          await tx.orderStockAllocation.update({
            where: { id: alloc.id },
            data: { 
              quantity: newOldQty,
              totalCost: newOldTotal
            }
          });

          // Insert new piece bound to target lot
          await tx.orderStockAllocation.create({
            data: {
              orderId: alloc.orderId,
              inventoryItemId: dstUpdatedId,
              productId: alloc.productId,
              variantId: alloc.variantId,
              quantity: assignAmount,
              unitCost: alloc.unitCost,
              totalCost: assignAmount * alloc.unitCost,
              action: alloc.action,
              createdAt: alloc.createdAt
            }
          });
          touchedOrderIds.add(alloc.orderId);
        }

        allocToMove -= assignAmount;
      }

      if (allocToMove !== 0) {
        const err: any = new Error(
          `Failed to fully rebind reservations for lotId=${src.id}. Remaining=${allocToMove}.`
        );
        err.code = 'ALLOCATIONS_REBIND_FAILED';
        throw err;
      }

      // 5. Movement logs
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: srcUpdated.id,
          type: 'Adjusted',
          quantityChange: -moveAmount,
          balance: srcUpdated.quantity,
          notes: `Reserved Transfer OUT to Packing Section. PV=${productId}-${variantId}. ${note || ''}`.trim(),
          user,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: dstUpdatedId,
          type: 'Adjusted',
          quantityChange: +moveAmount,
          balance: dstBalance,
          notes: `Reserved Transfer IN to Packing Section. PV=${productId}-${variantId}. ${note || ''}`.trim(),
          user,
        },
      });

      remainingToMove -= moveAmount;
    }

    if (touchedOrderIds.size > 0) {
      // For each touched order, determine if ALL allocations are now in Packing
      for (const oid of touchedOrderIds) {
        const allAllocs = await tx.orderStockAllocation.findMany({
          where: { orderId: oid, action: 'reserve', quantity: { gt: 0 } },
          include: { InventoryItem: { select: { locationId: true } } },
        });
        const allInPacking = allAllocs.length > 0 && allAllocs.every(a => a.InventoryItem?.locationId === packing.id);
        await tx.order.update({
          where: { id: oid },
          data: { stockReservedFrom: allInPacking ? 'packing' : 'mixed' },
        });
      }
    }

    return { success: true, message: 'Reserved stock transferred successfully.' };
  });
}

export async function transferGodownReservedStockAggregated(payload: {
  productId: string;
  variantId?: string | null;
  quantity: number;
  note?: string;
  user?: string;
}) {
  const godown = await prisma.stockLocation.findFirst({
    where: { name: { equals: 'Godown', mode: 'insensitive' } },
  });
  if (!godown) return { success: false, code: 'NO_GODOWN', message: 'Godown not found' };

  return transferReservedStockAggregatedLogic({
    ...payload,
    fromLocationId: godown.id
  });
}
