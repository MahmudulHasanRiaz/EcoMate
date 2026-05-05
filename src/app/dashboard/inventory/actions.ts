'use server';

import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';
import { randomBytes } from 'crypto';
import { ACCOUNT_LABELS, ensureDefaultAccounts, resolveLedgerEntryNumber } from '@/server/modules/accounting';

interface AdjustmentPayload {
  productId: string;
  variantId?: string;
  locationId: string;
  inventoryItemId: string;
  quantityChange: number; // e.g. 5
  adjustmentType: 'add' | 'remove';
  notes: string;
  user?: string;
  reference?: string;
  reason?: string; // Optional context
}

interface TransferPayload {
  productId: string;
  variantId?: string;
  fromLocationId: string;
  toLocationId: string;
  inventoryItemId: string;
  quantity: number; // positive
  notes: string;
  user: string;
}

const calculateAvailableQty = (quantity?: number | null, reserved?: number | null) =>
  Math.max((Number(quantity) || 0) - (Number(reserved) || 0), 0);

async function getAvailableQtyTx(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId?: string | null
) {
  const items = await tx.inventoryItem.findMany({
    where: { productId, variantId: variantId ?? null },
    select: { quantity: true, reservedQuantity: true },
  });
  return items.reduce((sum, item) => sum + calculateAvailableQty(item.quantity, item.reservedQuantity), 0);
}

export async function adjustStock(payload: AdjustmentPayload) {
  const { productId, variantId, locationId, inventoryItemId, quantityChange, adjustmentType, notes, user = 'System', reference } = payload;

  if (!productId || !locationId || !inventoryItemId) {
    return { success: false, message: 'Product, location, and lot are required.' };
  }
  if (quantityChange <= 0) {
    return { success: false, message: 'Quantity must be greater than 0.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
      });
      if (!inventoryItem) {
        throw new Error('Selected lot not found.');
      }
      if (inventoryItem.productId !== productId) {
        throw new Error('Selected lot does not match the product.');
      }
      if ((inventoryItem.variantId ?? null) !== (variantId ?? null)) {
        throw new Error('Selected lot does not match the variant.');
      }
      if (inventoryItem.locationId !== locationId) {
        throw new Error('Selected lot does not match the location.');
      }

      const delta = adjustmentType === 'add' ? quantityChange : -quantityChange;

      if (delta < 0 && inventoryItem.quantity < quantityChange) {
        throw new Error('Insufficient stock for this adjustment.');
      }

      const beforeTotal = await getAvailableQtyTx(tx, productId, variantId ?? null);
      const prevAvailable = calculateAvailableQty(inventoryItem.quantity, inventoryItem.reservedQuantity);

      const updated = await tx.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { quantity: { increment: delta } },
      });
      const nextAvailable = calculateAvailableQty(updated.quantity, inventoryItem.reservedQuantity);
      const afterTotal = Math.max(beforeTotal - prevAvailable + nextAvailable, 0);

      // Record inventory movement
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: updated.id,
          type: 'Adjusted',
          quantityChange: delta,
          balance: updated.quantity,
          notes,
          user,
          reference: reference || null,
        },
      });

      // --- LEDGER ENTRIES ---
      const adjValue = Math.abs(delta) * (Number(inventoryItem.unitCost) || 0);
      if (adjValue > 0) {
        await ensureDefaultAccounts();
        const accounts = await tx.account.findMany({ select: { id: true, name: true } });
        const accountMap = new Map(accounts.map((a) => [a.name, a.id]));
        const inventoryAccountId = accountMap.get(ACCOUNT_LABELS.inventory) || accountMap.get('Inventory');
        const internalAdjustmentId = accountMap.get(ACCOUNT_LABELS.inventoryAdjustment) || accountMap.get('Inventory Adjustment');

        if (inventoryAccountId && internalAdjustmentId) {
          const entryNumber = await resolveLedgerEntryNumber(tx, { date: new Date() });
          const desc = `Stock Adjustment (${adjustmentType === 'add' ? '+' : '-'}): ${notes || 'Manual'}`;

          await tx.ledgerEntry.createMany({
            data: [
              {
                id: `cm${randomBytes(11).toString('hex')}`,
                date: new Date(),
                entryNumber,
                description: desc,
                sourceTransactionId: inventoryItem.id, // Linking to lot/item
                accountId: adjustmentType === 'add' ? inventoryAccountId : internalAdjustmentId,
                debit: adjValue,
                credit: 0
              },
              {
                id: `cm${randomBytes(11).toString('hex')}`,
                date: new Date(),
                entryNumber,
                description: desc,
                sourceTransactionId: inventoryItem.id,
                accountId: adjustmentType === 'add' ? internalAdjustmentId : inventoryAccountId,
                debit: 0,
                credit: adjValue
              }
            ],
            skipDuplicates: true
          });
        }
      }

      const crossingZero = (beforeTotal > 0 && afterTotal <= 0) || (beforeTotal <= 0 && afterTotal > 0);
      if (crossingZero) {
        try {
          // Skip inventory-triggered sync in publish mode
          const { getGeneralSettings } = await import('@/server/utils/app-settings');
          const settings = await getGeneralSettings();
          if (settings.stockSyncMode !== 'publish') {
            const { triggerStockStatusSync } = await import('@/server/modules/stock-sync');
            await triggerStockStatusSync(productId, variantId || null, true);
          } else {
            console.log('[STOCK_SYNC_SKIP] Publish mode active, skipping inventory-triggered sync');
          }
        } catch (err) {
          console.error('[STOCK_SYNC_TRIGGER_ERROR]', err);
        }
      }
    });

    revalidateTag('inventory');
    revalidateTag('products');

    return { success: true, message: 'Stock adjusted successfully.' };
  } catch (error: any) {
    console.error('[SERVER_ACTION_ERROR:adjustStock]', error);
    return { success: false, message: error.message || 'Failed to adjust stock.' };
  }
}

export async function transferStock(payload: TransferPayload) {
  try {
    const { transferStockLogic } = await import('@/server/modules/inventory-transfers');
    await transferStockLogic(payload);
    revalidateTag('inventory');
    revalidateTag('products');
    return { success: true, message: 'Stock transferred successfully.' };
  } catch (error: any) {
    console.error('[SERVER_ACTION_ERROR:transferStock]', error);
    return { success: false, message: error.message || 'Failed to transfer stock.' };
  }
}

export async function transferGodownStockAggregated(payload: {
  productId: string;
  variantId?: string;
  quantity: number;
}) {
  try {
    const { transferGodownStockAggregatedLogic } = await import('@/server/modules/inventory-transfers');
    await transferGodownStockAggregatedLogic(payload);
    revalidateTag('inventory');
    revalidateTag('products');
    return { success: true, message: 'Stock transferred successfully.' };
  } catch (error: any) {
    console.error('[SERVER_ACTION_ERROR:transferGodownStockAggregated]', error);
    return { success: false, message: error.message || 'Failed to transfer stock.' };
  }
}


export async function transferReservedStockAggregated(payload: {
  productId: string;
  variantId?: string | null;
  fromLocationId: string;
  quantity: number;
  note?: string;
  user?: string;
}) {
  try {
    const { transferReservedStockAggregatedLogic } = await import('@/server/modules/inventory-transfers');
    const result = await transferReservedStockAggregatedLogic(payload);
    revalidateTag('inventory');
    revalidateTag('products');
    return result || { success: true, message: 'Reserved stock transferred successfully.' };
  } catch (error: any) {
    console.error('[SERVER_ACTION_ERROR:transferReservedStockAggregated]', error);
    return { 
      success: false, 
      code: error.code || 'TRANSFER_ERROR', 
      message: error.message || 'Failed to transfer reserved stock.' 
    };
  }
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

  return transferReservedStockAggregated({
    ...payload,
    fromLocationId: godown.id
  });
}
