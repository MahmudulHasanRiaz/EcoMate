import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getRedisClient } from '@/server/queues/redis';

type InventoryItemWithLocation = Prisma.InventoryItemGetPayload<{
  include: { StockLocation: true };
}>;

export type StockAllocation = {
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  lotNumber: string;
  quantity: number;
  unitCost?: number;
  totalCost?: number;
  balance?: number;
};

export type StockAllocationResult = {
  requested: number;
  fulfilled: number;
  shortage: number;
  availableBefore: number;
  availableAfter: number;
  allocations: StockAllocation[];
};

type AllocationDirection = 'asc' | 'desc';
const LOW_STOCK_ALERT_TTL_MS = 12 * 60 * 60 * 1000;
const lowStockAlertCache = new Map<string, number>();

const buildLowStockKey = (sku: string) => `low-stock:${sku}`;

async function shouldNotifyLowStock(sku: string) {
  if (!sku) return false;
  const redis = getRedisClient();
  if (redis) {
    const key = buildLowStockKey(sku.toLowerCase());
    const result = await redis.set(key, '1', 'PX', LOW_STOCK_ALERT_TTL_MS, 'NX');
    return Boolean(result);
  }
  const cacheKey = sku.toLowerCase();
  const last = lowStockAlertCache.get(cacheKey) || 0;
  if (Date.now() - last < LOW_STOCK_ALERT_TTL_MS) return false;
  lowStockAlertCache.set(cacheKey, Date.now());
  return true;
}

async function getLocationPriority(tx: Prisma.TransactionClient) {
  const locations = await tx.stockLocation.findMany({ orderBy: { createdAt: 'asc' } });
  if (locations.length === 0) return [];

  let defaultLocationId: string | null = null;
  try {
    const setting = await tx.appSetting.findUnique({ where: { key: 'inventory' } });
    const value = setting?.value as { defaultLocationId?: string } | null;
    if (value?.defaultLocationId) defaultLocationId = value.defaultLocationId;
  } catch (err) {
    console.warn('[STOCK_ALLOC] Could not read inventory settings:', err);
  }

  if (defaultLocationId) {
    const defaultLoc = locations.find((loc) => loc.id === defaultLocationId);
    if (defaultLoc) {
      return [defaultLoc, ...locations.filter((loc) => loc.id !== defaultLocationId)];
    }
  }

  const godownIndex = locations.findIndex((loc) => /godown/i.test(loc.name));
  if (godownIndex > 0) {
    const godown = locations[godownIndex];
    return [godown, ...locations.filter((loc) => loc.id !== godown.id)];
  }

  return locations;
}

function sortInventoryItems(
  items: InventoryItemWithLocation[],
  locationPriority: string[],
  direction: AllocationDirection
) {
  const priorityMap = new Map(locationPriority.map((id, idx) => [id, idx]));
  return items.sort((a, b) => {
    const locA = priorityMap.get(a.locationId) ?? Number.MAX_SAFE_INTEGER;
    const locB = priorityMap.get(b.locationId) ?? Number.MAX_SAFE_INTEGER;
    if (locA !== locB) return locA - locB;

    const dateA = a.receivedDate ?? a.createdAt;
    const dateB = b.receivedDate ?? b.createdAt;
    return direction === 'asc'
      ? dateA.getTime() - dateB.getTime()
      : dateB.getTime() - dateA.getTime();
  });
}

function buildAllocationResult(
  requested: number,
  fulfilled: number,
  availableBefore: number,
  allocations: StockAllocation[]
): StockAllocationResult {
  const shortage = Math.max(requested - fulfilled, 0);
  const availableAfter = Math.max(availableBefore - fulfilled, 0);
  return {
    requested,
    fulfilled,
    shortage,
    availableBefore,
    availableAfter,
    allocations,
  };
}

function allocationsSummary(allocations: StockAllocation[], unitLabel = 'qty') {
  if (allocations.length === 0) return 'No stock allocated';
  return allocations
    .map((a) => `${a.locationName}/${a.lotNumber} ${unitLabel}:${a.quantity}`)
    .join(', ');
}

export function formatAllocationSummary(result: StockAllocationResult, unitLabel = 'qty') {
  const base = allocationsSummary(result.allocations, unitLabel);
  if (result.shortage > 0) {
    return `${base} | short by ${result.shortage}`;
  }
  return base;
}

async function maybeTriggerStockSync(
  productId: string,
  variantId: string | null,
  before: number,
  after: number
) {
  try {
    const crossingZero = (before > 0 && after <= 0) || (before <= 0 && after > 0);
    if (!crossingZero) return;

    // Skip inventory-triggered sync in publish mode
    const { getGeneralSettings } = await import('../utils/app-settings');
    const settings = await getGeneralSettings();
    if (settings.stockSyncMode === 'publish') {
      console.log('[STOCK_SYNC_SKIP] Publish mode active, skipping inventory-triggered sync');
      return;
    }

    const { triggerStockStatusSync } = await import('./stock-sync');
    await triggerStockStatusSync(productId, variantId, true);
  } catch (err) {
    console.error('[STOCK_SYNC_TRIGGER_ERROR]', err);
  }
}

async function checkLowStockAlert(productId: string, variantId: string | null, availableStock: number) {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'lowStockThreshold' } });
    const threshold = (setting?.value as any)?.threshold ?? 5;

    if (availableStock > 0 && availableStock <= threshold) {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      let sku = product?.sku || '';
      let name = product?.name || '';

      if (variantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
        sku = variant?.sku || sku;
        name = `${name} (${variant?.name})`;
      }

      const shouldNotify = await shouldNotifyLowStock(sku || `${productId}${variantId ? `-${variantId}` : ''}`);
      if (!shouldNotify) return;

      const { notifyAdmins } = await import('./notifications');
      await notifyAdmins(
        'Low Stock Alert',
        `Product ${sku} - ${name} has only ${availableStock} unit(s) available`,
        '/dashboard/inventory',
        'AlertCircle'
      );
    }
  } catch (err) {
    console.error('[LOW_STOCK_ALERT_ERROR]', err);
  }
}

async function getInventoryItems(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId?: string | null,
  locationId?: string | null
) {
  // Hard rule: variable products must always specify a variant for stock ops.
  // Base SKU of variable products should never hold stock directly.
  if ((variantId ?? null) === null) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { productType: true, name: true, sku: true },
    });
    if (product?.productType === 'variable') {
      const err: any = new Error(
        `Variable product "${product.name || product.sku}" cannot hold stock on base SKU. A variant must be specified.`
      );
      err.code = 'VARIANT_MISSING';
      err.productId = productId;
      err.sku = product.sku;
      throw err;
    }
  }

  const locationPriority = await getLocationPriority(tx);
  const where: any = { productId, variantId: variantId ?? null };
  if (locationId) where.locationId = locationId;

  let items = await tx.inventoryItem.findMany({
    where,
    include: { StockLocation: true },
  });

  // Fallback for legacy/mixed setups:
  // when a line is variant-agnostic (variantId=null) but stock is stored on variants,
  // use pooled product lots to avoid false "insufficient stock" rejections.
  if (items.length === 0 && (variantId ?? null) === null) {
    const fallbackWhere: any = { productId };
    if (locationId) fallbackWhere.locationId = locationId;
    items = await tx.inventoryItem.findMany({
      where: fallbackWhere,
      include: { StockLocation: true },
    });
  }

  // Prevent auto-reserving from restricted locations when locationId is not explicitly requested
  if (!locationId) {
    items = items.filter((item) => {
      const locName = item.StockLocation?.name || '';
      return !/return|pos|showroom/i.test(locName);
    });
  }

  return {
    items: sortInventoryItems(items, locationPriority.map((l) => l.id), 'asc'),
    locationPriority,
  };
}

export async function reserveStockAcrossLots(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number
) {
  const { items, locationPriority } = await getInventoryItems(tx, productId, variantId);
  if (!items.length) {
    return buildAllocationResult(quantity, 0, 0, []);
  }

  const availableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );

  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const item of items) {
    if (remaining <= 0) break;
    const available = Math.max(item.quantity - item.reservedQuantity, 0);
    if (available <= 0) continue;
    const alloc = Math.min(available, remaining);
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { reservedQuantity: { increment: alloc } },
    });
    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: alloc,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * alloc).toFixed(2)),
    });
    remaining -= alloc;
  }

  const fulfilled = quantity - remaining;
  const result = buildAllocationResult(quantity, fulfilled, availableBefore, allocations);
  await maybeTriggerStockSync(productId, variantId, result.availableBefore, result.availableAfter);
  await checkLowStockAlert(productId, variantId, result.availableAfter);
  return result;
}

export async function releaseReservedStockAcrossLots(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number
) {
  const { items } = await getInventoryItems(tx, productId, variantId);
  if (!items.length) {
    return buildAllocationResult(quantity, 0, 0, []);
  }

  const availableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );

  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const item of items) {
    if (remaining <= 0) break;
    // Guard: only release up to what's actually reserved on this item
    const reservable = Math.max(item.reservedQuantity, 0);
    if (reservable <= 0) continue;
    const releaseQty = Math.min(reservable, remaining);
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { reservedQuantity: { decrement: releaseQty } },
    });
    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: releaseQty,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * releaseQty).toFixed(2)),
    });
    remaining -= releaseQty;
  }

  const fulfilled = quantity - remaining;
  const result = buildAllocationResult(quantity, fulfilled, availableBefore, allocations);
  const availableAfter = availableBefore + fulfilled;
  result.availableAfter = availableAfter;
  await maybeTriggerStockSync(productId, variantId, availableBefore, availableAfter);
  await checkLowStockAlert(productId, variantId, availableAfter);
  return result;
}

export async function deductStockAcrossLots(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number
) {
  const { items, locationPriority } = await getInventoryItems(tx, productId, variantId);
  if (!items.length) {
    return buildAllocationResult(quantity, 0, 0, []);
  }

  // BUG-3 FIX: Use unreserved stock for availability check, not total quantity.
  // Reserved stock belongs to other orders and must not be double-allocated.
  const totalAvailableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0), 0
  );
  if (totalAvailableBefore < quantity) {
    throw new Error(
      `Insufficient stock for product ${productId}${variantId ? ` (${variantId})` : ''}. Available ${totalAvailableBefore}, required ${quantity}`
    );
  }

  const sorted = sortInventoryItems(items, locationPriority.map((l) => l.id), 'asc');
  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const item of sorted) {
    if (remaining <= 0) break;
    // Use unreserved quantity as the available pool
    const available = Math.max(item.quantity - item.reservedQuantity, 0);
    if (available <= 0) continue;
    const alloc = Math.min(available, remaining);
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { decrement: alloc } },
    });
    const newQty = updated.quantity;

    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: alloc,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * alloc).toFixed(2)),
      balance: newQty,
    });
    remaining -= alloc;
  }

  const fulfilled = quantity - remaining;
  const result = buildAllocationResult(quantity, fulfilled, totalAvailableBefore, allocations);
  await maybeTriggerStockSync(productId, variantId, result.availableBefore, result.availableAfter);
  await checkLowStockAlert(productId, variantId, result.availableAfter);
  return result;
}

export async function restoreStockAcrossLots(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number
) {
  const { items, locationPriority } = await getInventoryItems(tx, productId, variantId);
  if (!items.length) {
    return buildAllocationResult(quantity, 0, 0, []);
  }

  const totalBefore = items.reduce((sum, item) => sum + item.quantity, 0);
  // BUG-4 FIX: Distribute proportionally across existing lots instead of
  // dumping the entire quantity into the first lot.
  const sorted = sortInventoryItems(items, locationPriority.map((l) => l.id), 'desc');
  let remaining = quantity;
  const allocations: StockAllocation[] = [];

  if (sorted.length === 1) {
    // Only one lot — restore everything there
    const item = sorted[0];
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { increment: remaining } },
    });
    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: remaining,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * remaining).toFixed(2)),
      balance: updated.quantity,
    });
    remaining = 0;
  } else {
    // Multiple lots: distribute proportionally based on existing quantity
    const totalExisting = sorted.reduce((s, i) => s + Math.max(i.quantity, 0), 0);
    for (let i = 0; i < sorted.length && remaining > 0; i++) {
      const item = sorted[i];
      const isLast = i === sorted.length - 1;
      // Proportional share; last lot gets the remainder to avoid rounding errors
      const share = isLast
        ? remaining
        : (totalExisting > 0
            ? Math.round((Math.max(item.quantity, 0) / totalExisting) * quantity)
            : Math.ceil(quantity / sorted.length));
      const alloc = Math.min(share, remaining);
      if (alloc <= 0) continue;

      const updated = await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { increment: alloc } },
      });
      allocations.push({
        inventoryItemId: item.id,
        locationId: item.locationId,
        locationName: item.StockLocation.name,
        lotNumber: item.lotNumber,
        quantity: alloc,
        unitCost: item.unitCost ?? 0,
        totalCost: Number(((item.unitCost ?? 0) * alloc).toFixed(2)),
        balance: updated.quantity,
      });
      remaining -= alloc;
    }
  }

  const fulfilled = quantity - remaining;
  const result = buildAllocationResult(quantity, fulfilled, totalBefore, allocations);
  const availableAfter = totalBefore + fulfilled;
  result.availableAfter = availableAfter;
  await maybeTriggerStockSync(productId, variantId, totalBefore, availableAfter);
  await checkLowStockAlert(productId, variantId, availableAfter);
  return result;
}

export async function restoreStockToLocation(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
  locationId: string,
  lotNumber: string = 'RETURNED',
  unitCost?: number
): Promise<StockAllocationResult> {
  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
    select: { name: true }
  });
  if (!location) throw new Error(`Stock location ${locationId} not found`);

  let item = await tx.inventoryItem.findFirst({
    where: { productId, variantId: variantId ?? null, locationId, lotNumber },
    include: { StockLocation: true }
  });

  const beforeQty = item?.quantity || 0;

  if (!item) {
    let finalUnitCost = unitCost;
    if (finalUnitCost === undefined) {
      const otherItems = await tx.inventoryItem.findMany({
        where: { productId, variantId: variantId ?? null },
        select: { unitCost: true }
      });
      const validCosts = otherItems.map(i => Number(i.unitCost || 0)).filter(c => c > 0);
      finalUnitCost = validCosts.length > 0 ? validCosts.reduce((a, b) => a + b, 0) / validCosts.length : 0;
    }

    item = await tx.inventoryItem.create({
      data: {
        productId,
        variantId: variantId ?? null,
        locationId,
        lotNumber,
        quantity,
        reservedQuantity: 0,
        unitCost: finalUnitCost,
        receivedDate: new Date(),
      },
      include: { StockLocation: true }
    });
  } else {
    const updateData: any = { quantity: { increment: quantity } };
    if (unitCost !== undefined) updateData.unitCost = unitCost;
    
    item = await tx.inventoryItem.update({
      where: { id: item.id },
      data: updateData,
      include: { StockLocation: true }
    });
  }

  const result = buildAllocationResult(quantity, quantity, beforeQty, [{
    inventoryItemId: item!.id,
    locationId: item!.locationId,
    locationName: item!.StockLocation.name,
    lotNumber: item!.lotNumber,
    quantity: quantity,
    unitCost: Number(item!.unitCost || 0),
    totalCost: Number(((item!.unitCost || 0) * quantity).toFixed(2)),
    balance: item!.quantity
  }]);

  result.availableAfter = beforeQty + quantity;

  await maybeTriggerStockSync(productId, variantId, beforeQty, item!.quantity);
  return result;
}

export async function resolveLocationIdByName(tx: Prisma.TransactionClient, name: string) {
  const loc = await tx.stockLocation.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } }
  });
  if (!loc) throw new Error(`Stock location '${name}' not found`);
  return loc.id;
}

export async function reserveStockFromLocation(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
  locationId: string
) {
  const { items } = await getInventoryItems(tx, productId, variantId, locationId);
  if (!items.length) {
    return buildAllocationResult(quantity, 0, 0, []);
  }

  const availableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );

  let remaining = quantity;
  const allocations: StockAllocation[] = [];
  for (const item of items) {
    if (remaining <= 0) break;
    const available = Math.max(item.quantity - item.reservedQuantity, 0);
    if (available <= 0) continue;
    const alloc = Math.min(available, remaining);
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { reservedQuantity: { increment: alloc } },
    });
    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: alloc,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * alloc).toFixed(2)),
    });
    remaining -= alloc;
  }
  const result = buildAllocationResult(quantity, quantity - remaining, availableBefore, allocations);
  await maybeTriggerStockSync(productId, variantId, availableBefore, result.availableAfter);
  return result;
}

export async function releaseReservedStockFromLocation(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
  locationId: string
) {
  const { items } = await getInventoryItems(tx, productId, variantId, locationId);
  items.sort((a, b) => b.reservedQuantity - a.reservedQuantity);
  
  const availableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );

  let remaining = quantity;
  for (const item of items) {
    if (remaining <= 0) break;
    if (item.reservedQuantity <= 0) continue;
    
    const release = Math.min(item.reservedQuantity, remaining);
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { reservedQuantity: { decrement: release } },
    });
    remaining -= release;
  }

  const fulfilled = quantity - remaining;
  const result = buildAllocationResult(quantity, fulfilled, availableBefore, []);
  result.availableAfter = availableBefore + fulfilled;

  await maybeTriggerStockSync(productId, variantId, availableBefore, result.availableAfter);
  return result;
}

export async function getAvailableQtyAtLocation(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  locationId: string
) {
  const { items } = await getInventoryItems(tx, productId, variantId, locationId);
  return items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );
}

export async function deductStockFromLocation(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  quantity: number,
  locationId: string,
  deductFromReserved: boolean = false
) {
  const { items } = await getInventoryItems(tx, productId, variantId, locationId);
  if (deductFromReserved) {
    items.sort((a, b) => b.reservedQuantity - a.reservedQuantity);
  } else {
    items.sort((a, b) => (a.quantity - a.reservedQuantity) - (b.quantity - b.reservedQuantity));
  }

  const availableBefore = items.reduce(
    (sum, item) => sum + Math.max(item.quantity - item.reservedQuantity, 0),
    0
  );

  let remaining = quantity;
  const allocations: StockAllocation[] = [];

  for (const item of items) {
    if (remaining <= 0) break;

    const available = deductFromReserved 
      ? item.reservedQuantity 
      : Math.max(item.quantity - item.reservedQuantity, 0);

    if (available <= 0) continue;

    const deduct = Math.min(available, remaining);
    
    const updateData: any = { quantity: { decrement: deduct } };
    if (deductFromReserved) {
      updateData.reservedQuantity = { decrement: deduct };
    }

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: updateData,
    });

    allocations.push({
      inventoryItemId: item.id,
      locationId: item.locationId,
      locationName: item.StockLocation.name,
      lotNumber: item.lotNumber,
      quantity: deduct,
      unitCost: item.unitCost ?? 0,
      totalCost: Number(((item.unitCost ?? 0) * deduct).toFixed(2)),
      balance: updated.quantity,
    });

    remaining -= deduct;
  }

  const result = buildAllocationResult(quantity, quantity - remaining, availableBefore, allocations);
  if (deductFromReserved) {
    result.availableAfter = availableBefore;
  } else {
    await maybeTriggerStockSync(productId, variantId, availableBefore, result.availableAfter);
  }
  return result;
}
