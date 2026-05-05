import { Prisma } from '@prisma/client';
import { getGeneralSettings } from '@server/utils/app-settings';
import {
    formatAllocationSummary,
    releaseReservedStockAcrossLots,
    reserveStockAcrossLots,
    reserveStockFromLocation,
    releaseReservedStockFromLocation,
} from './stock-allocation';

function createInsufficientStockError(message: string) {
    const err: any = new Error(message);
    err.code = 'INSUFFICIENT_STOCK';
    return err;
}

export const PRODUCT_WITH_BRAND_INCLUDE = {
  include: {
    Brand: { select: { id: true, name: true, type: true } },
    variants: true,
    comboItems: {
      include: {
        child: {
          include: {
            Brand: { select: { id: true, name: true, type: true } },
            variants: true,
          }
        }
      }
    }
  }
} as const;

export const ORDER_WITH_PRODUCTS_AND_BRANDS_INCLUDE = {
  include: {
    products: {
      include: {
        product: PRODUCT_WITH_BRAND_INCLUDE,
      }
    }
  }
} as const;

/**
 * Strict combo component resolver.
 * - Resolves child components from comboItems + componentBreakdown
 * - Only matches variants by exact variantId (no SKU fallback)
 * - Throws VARIANT_MISSING if a variable child has no resolved variantId
 */
export function resolveComboComponents(orderProduct: any, fallbackOrderQty: number) {
    const product = orderProduct?.product;
    const comboItems = Array.isArray(product?.comboItems) ? product.comboItems : [];
    const breakdown = Array.isArray(orderProduct?.componentBreakdown) ? orderProduct.componentBreakdown : [];
    const orderQty = Number(fallbackOrderQty || 0);

    // Build breakdown lookup -- used ONLY for quantity, never for variantId
    const breakdownByProductId = new Map<string, any>();
    for (const comp of breakdown) {
        const pid = comp?.productId ? String(comp.productId) : '';
        if (!pid) continue;
        breakdownByProductId.set(pid, comp);
    }

    const components: Array<{
        productId: string;
        variantId: string | null;
        quantity: number;
        name?: string;
        sku?: string;
        child?: any;
        variant?: any;
    }> = [];

    for (const ci of comboItems) {
        const childId = String(ci?.child?.id || ci?.childId || '');
        if (!childId) continue;

        const match = breakdownByProductId.get(childId);

        // --- SOURCE OF TRUTH: combo definition variantId ONLY ---
        const definitionVariantId = ci?.variantId || null;

        // Warn if breakdown has a different variantId (stale data)
        if (match?.variantId && definitionVariantId && match.variantId !== definitionVariantId) {
            console.warn(
                `[COMBO_VARIANT_MISMATCH] ProductId=${childId}: breakdown has variantId=${match.variantId} ` +
                `but combo definition says variantId=${definitionVariantId}. Using combo definition.`
            );
        }

        const resolvedVariantId = definitionVariantId;
        const childVariants = Array.isArray(ci?.child?.variants) ? ci.child.variants : [];
        const resolvedVariant = resolvedVariantId
            ? childVariants.find((v: any) => v?.id === resolvedVariantId) || ci?.variant || null
            : null;

        // Guard: if child is a variable/piece product, variantId is mandatory from combo definition
        const childType = ci?.child?.productType;
        if ((childType === 'variable' || childType === 'piece') && !resolvedVariantId) {
            const childSku = ci?.child?.sku || childId;
            const err: any = new Error(
                `Combo child "${ci?.child?.name || childSku}" is variable but no variant is set in the combo definition. Edit the combo product to assign a default variant.`
            );
            err.code = 'VARIANT_MISSING';
            err.productId = childId;
            err.sku = childSku;
            throw err;
        }

        // Quantity: sourced from breakdown if available (preserves per-order overrides), else order qty
        const qty = Number(match?.quantity ?? orderQty);

        components.push({
            productId: childId,
            variantId: resolvedVariantId,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : orderQty,
            name: match?.name || ci?.child?.name,
            sku: resolvedVariant?.sku || ci?.child?.sku,
            child: ci?.child,
            variant: resolvedVariant || ci?.variant,
        });
    }

    return components.filter((c) => Number(c.quantity || 0) > 0);
}

// --- Quantity-Aware Idempotency ---

/**
 * Sum already-allocated quantity for a given (orderId, productId, variantId, action).
 * Returns the total quantity already allocated. If >= required, the caller should skip.
 * If < required, the caller should only allocate the delta.
 */
async function getExistingAllocationQty(
    tx: Prisma.TransactionClient,
    orderId: string,
    productId: string,
    variantId: string | null,
    action: string
): Promise<number> {
    const rows = await tx.orderStockAllocation.findMany({
        where: { orderId, productId, variantId: variantId ?? null, action },
        select: { quantity: true },
    });
    return rows.reduce((sum, r) => sum + (r.quantity || 0), 0);
}

export function aggregateOrderRequirements(order: any): Map<string, { productId: string; variantId: string | null; quantity: number; sku: string; brandType?: string; isPublished?: boolean }> {
    const aggregated = new Map<string, { productId: string; variantId: string | null; quantity: number; sku: string; brandType?: string; isPublished?: boolean }>();

    for (const orderProduct of order.products || []) {
        const qty = Number(orderProduct.quantity || 0);
        if (qty <= 0) continue;

        if (orderProduct.product?.productType === 'combo' && orderProduct.product?.comboItems?.length > 0) {
            const components = resolveComboComponents(orderProduct, qty);
            for (const component of components) {
                const compQty = Number(component.quantity || 0);
                if (compQty <= 0) continue;
                const key = `${component.productId}:${component.variantId ?? ''}`;
                const sku = component.variant?.sku || component.sku || component.child?.sku || component.productId;
                const brandType = component.child?.Brand?.type;
                const existing = aggregated.get(key);
                if (existing) {
                    existing.quantity += compQty;
                } else {
                    aggregated.set(key, {
                        productId: component.productId,
                        variantId: component.variantId || null,
                        quantity: compQty,
                        sku,
                        brandType,
                        isPublished: component.child?.isPublished
                    });
                }
            }
        } else {
            const key = `${orderProduct.productId}:${orderProduct.variantId ?? ''}`;
            const variant = orderProduct.product?.variants?.find((v: any) => v.id === orderProduct.variantId);
            const sku = variant?.sku || orderProduct.product?.sku || orderProduct.sku || orderProduct.productId;
            const brandType = orderProduct.product?.Brand?.type;
            const existing = aggregated.get(key);
            if (existing) {
                existing.quantity += qty;
            } else {
                aggregated.set(key, {
                    productId: orderProduct.productId,
                    variantId: orderProduct.variantId || null,
                    quantity: qty,
                    sku,
                    brandType,
                    isPublished: orderProduct.product?.isPublished
                });
            }
        }
    }
    // Filter out 'Out' brand products from inventory requirements
    for (const [key, value] of aggregated.entries()) {
        if (value.brandType === 'Out') {
            aggregated.delete(key);
        }
    }

    return aggregated;
}

/**
 * Reserve stock for New orders (soft booking to prevent overselling)
 */
export async function handleStockReservation(tx: Prisma.TransactionClient, order: any, user: string, locationId?: string | null) {
    if (!order.products || order.products.length === 0) return;

    const settings = await getGeneralSettings();
    const isPublishMode = settings.stockSyncMode === 'publish';

    const aggregated = aggregateOrderRequirements(order);
    if (aggregated.size === 0) return;

    const logLines: string[] = [];
    for (const entry of aggregated.values()) {
        const { productId, variantId, quantity, sku, brandType, isPublished } = entry;
        if (brandType === 'Out') {
            console.log(`[STOCK_RESERVE_SKIP] Skipping 'Out' brand product: ${sku}`);
            continue;
        }
        const qty = Number(quantity || 0);
        if (qty <= 0) continue;

        // Quantity-aware idempotency: check how much is already reserved
        const alreadyReserved = await getExistingAllocationQty(tx, order.id, productId, variantId || null, 'reserve');
        if (alreadyReserved >= qty) {
            console.warn(`[STOCK_IDEMPOTENT] Reserve fully covered for order=${order.id} product=${productId} variant=${variantId} (have=${alreadyReserved} need=${qty}), skipping`);
            continue;
        }
        const delta = qty - alreadyReserved;
        if (alreadyReserved > 0) {
            console.log(`[STOCK_IDEMPOTENT] Partial reserve exists for order=${order.id} product=${productId} (have=${alreadyReserved} need=${qty}, delta=${delta})`);
        }

        console.log(`[STOCK_RESERVE] Item: PI:${productId} VI:${variantId} Qty:${delta}`);

        const result = locationId
            ? await reserveStockFromLocation(tx, productId, variantId || null, delta, locationId)
            : await reserveStockAcrossLots(tx, productId, variantId || null, delta);
        if (result.fulfilled > 0) {
            logLines.push(`${sku}: ${formatAllocationSummary(result)}`);
        }
        if (result.shortage > 0) {
            const available = Math.max(qty - result.shortage, 0);
            throw createInsufficientStockError(`Insufficient stock: ${sku}. Required: ${qty}, Available: ${available}`);
        }

        // Write reserve allocation records for audit + idempotency
        for (const alloc of result.allocations) {
            await tx.orderStockAllocation.create({
                data: {
                    orderId: order.id,
                    inventoryItemId: alloc.inventoryItemId,
                    productId,
                    variantId: variantId || null,
                    quantity: alloc.quantity,
                    unitCost: Number(alloc.unitCost ?? 0),
                    totalCost: Number(alloc.totalCost ?? ((alloc.unitCost ?? 0) * alloc.quantity)),
                    action: 'reserve',
                },
            });
        }
    }

    if (logLines.length) {
        await tx.orderLog.create({
            data: {
                orderId: order.id,
                title: 'Stock Reserved',
                description: logLines.join('\n'),
                user,
            },
        });
    }
}

export async function handleStockReservationRelease(tx: Prisma.TransactionClient, order: any, user: string, locationId?: string | null) {
    if (!order.products || order.products.length === 0) return;

    const logLines: string[] = [];

    // Prefer releasing based on the exact allocation records for this order.
    // This is critical after moving allocations between locations (e.g., Godown -> Packing),
    // because a generic "release across lots" may release from the wrong location and leave
    // the order's actual reserved lots untouched.
    const exactAllocations = await tx.orderStockAllocation.findMany({
        where: { orderId: order.id, action: 'reserve' },
        include: { InventoryItem: { include: { StockLocation: true } } },
    });

    if (exactAllocations.length > 0) {
        const aggregated = aggregateOrderRequirements(order);
        const skuByKey = new Map<string, string>();
        for (const [key, entry] of aggregated.entries()) skuByKey.set(key, entry.sku);

        for (const alloc of exactAllocations) {
            const qty = Number(alloc.quantity || 0);
            if (!Number.isFinite(qty) || qty <= 0) continue;

            const currentReserved = Number(alloc.InventoryItem?.reservedQuantity ?? 0);
            if (currentReserved < qty) {
                const err: any = new Error(
                    `Reservation mismatch while releasing order=${order.id}. ` +
                    `InventoryItem=${alloc.inventoryItemId} has reservedQuantity=${currentReserved} but allocation wants to release=${qty}. ` +
                    `Run the repair/reset scripts before retrying.`
                );
                err.code = 'RESERVATION_MISMATCH';
                err.orderId = order.id;
                err.inventoryItemId = alloc.inventoryItemId;
                err.productId = alloc.productId;
                err.variantId = alloc.variantId;
                err.requiredRelease = qty;
                err.availableReserved = currentReserved;
                throw err;
            }

            await tx.inventoryItem.update({
                where: { id: alloc.inventoryItemId },
                data: { reservedQuantity: { decrement: qty } },
            });

            const key = `${alloc.productId}:${alloc.variantId ?? ''}`;
            const sku = skuByKey.get(key) || alloc.productId;
            const locName = alloc.InventoryItem?.StockLocation?.name || 'Unknown';
            const lot = alloc.InventoryItem?.lotNumber ? `/${alloc.InventoryItem.lotNumber}` : '';
            logLines.push(`${sku}: ${locName}${lot} qty:${qty}`);
        }

        await tx.orderStockAllocation.deleteMany({
            where: { orderId: order.id, action: 'reserve' },
        });
    } else {
        // Fallback for legacy orders that have reservedQuantity but no allocation rows.
        // This path is best-effort and may release from any lots for this PV.
        const aggregated = aggregateOrderRequirements(order);
        if (aggregated.size === 0) return;

        for (const entry of aggregated.values()) {
            const { productId, variantId, quantity, sku } = entry;
            const qty = Number(quantity || 0);
            if (qty <= 0) continue;

            const result = locationId
                ? await releaseReservedStockFromLocation(tx, productId, variantId || null, qty, locationId)
                : await releaseReservedStockAcrossLots(tx, productId, variantId || null, qty);
            if (result.fulfilled > 0) {
                logLines.push(`${sku}: ${formatAllocationSummary(result)}`);
            }
        }

        // Clean up reserve allocation records on release (no-op for legacy orders)
        await tx.orderStockAllocation.deleteMany({
            where: { orderId: order.id, action: 'reserve' },
        });
    }

    if (logLines.length) {
        await tx.orderLog.create({
            data: {
                orderId: order.id,
                title: 'Stock Reservation Released',
                description: logLines.join('\n'),
                user,
            },
        });
    }
}

