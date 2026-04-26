
import prisma from '@/lib/prisma';
import type { InventoryItem } from '@/types';

// Matching the UI type
type InventoryItemWithSourceIds = InventoryItem & {
    sourceItemIds: string[];
};

const normalizeUrl = (input?: string | null) => {
    if (!input) return undefined;
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
};

const parseProductImage = (imageString?: string | null): string | undefined => {
    if (!imageString) return undefined;
    try {
        const parsed = JSON.parse(imageString);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].url;
        return undefined;
    } catch {
        return imageString;
    }
};

type GetInventoryParams = {
    cursor?: string;
    pageSize?: number;
    search?: string;
    locationId?: string;
    productId?: string;
    variantId?: string;
    status?: 'active' | 'low-stock' | 'low-stock-available' | 'out-of-stock' | 'all';
    lowStockThreshold?: number;
};

type GetInventoryResponse = {
    items: InventoryItemWithSourceIds[];
    nextCursor: string | null;
};

export async function getInventoryPaginated(params: GetInventoryParams): Promise<GetInventoryResponse> {
    const { cursor, pageSize = 50, search, locationId, productId, variantId, status = 'active', lowStockThreshold = 5 } = params;

    // 1. Build base where clause for InventoryItem queries
    const baseItemWhere: any = {};

    if (locationId && locationId !== 'all') {
        baseItemWhere.locationId = locationId;
    }
    if (productId) {
        baseItemWhere.productId = productId;
    }
    if (variantId) {
        baseItemWhere.variantId = variantId;
    }
    if (search) {
        baseItemWhere.Product = {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } }
            ]
        };
    }

    // 2. For low-stock / low-stock-available / out-of-stock:
    //    Find products at the AGGREGATE level first.
    let lowStockProductIds: string[] | null = null;
    let lowStockPvKeys: Set<string> | null = null;

    const isLowStockMode = status === 'low-stock' || status === 'low-stock-available';
    const isOutOfStockMode = status === 'out-of-stock';

    if (isLowStockMode || isOutOfStockMode) {
        // Build a clean where for groupBy (no relation-level filters like Product)
        const groupByWhere: any = {};
        if (locationId && locationId !== 'all') groupByWhere.locationId = locationId;
        if (productId) groupByWhere.productId = productId;
        if (variantId) groupByWhere.variantId = variantId;
        if (search) {
            groupByWhere.Product = {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ]
            };
        }

        if (isOutOfStockMode) {
            // Out of stock: SUM(quantity) <= 0
            const oosGroups = await prisma.inventoryItem.groupBy({
                by: ['productId', 'variantId'],
                where: groupByWhere,
                _sum: { quantity: true },
                having: {
                    quantity: { _sum: { lte: 0 } }
                }
            });
            lowStockPvKeys = new Set(oosGroups.map(g => `${g.productId}__${g.variantId || 'none'}`));
            lowStockProductIds = [...new Set(oosGroups.map(g => g.productId))];

            // Also include products that have NO InventoryItem rows (at the selected location/variant)
            const noneFilter: any = {};
            if (locationId && locationId !== 'all') noneFilter.locationId = locationId;
            if (variantId) noneFilter.variantId = variantId;

            // When variantId is provided, scope to its owning product only
            let variantOwnerProductId: string | null = null;
            if (variantId) {
                const variant = await prisma.productVariant.findUnique({
                    where: { id: variantId },
                    select: { productId: true },
                });
                if (!variant) {
                    return { items: [], nextCursor: null };
                }
                variantOwnerProductId = variant.productId;
            }

            const noInvProductWhere: any = { productType: { not: 'combo' },
                InventoryItem: { none: noneFilter },
            };
            if (variantOwnerProductId) {
                noInvProductWhere.id = variantOwnerProductId;
            } else if (productId) {
                noInvProductWhere.id = productId;
            }
            if (search) {
                noInvProductWhere.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ];
            }
            const noInvProducts = await prisma.product.findMany({
                where: noInvProductWhere,
                select: { id: true },
            });
            for (const p of noInvProducts) {
                lowStockPvKeys.add(`${p.id}__${variantId || 'none'}`);
                if (!lowStockProductIds.includes(p.id)) {
                    lowStockProductIds.push(p.id);
                }
            }
            
            if (variantId && variantOwnerProductId) {
                lowStockProductIds = lowStockProductIds.filter(id => id === variantOwnerProductId);
                lowStockPvKeys = new Set([...lowStockPvKeys].filter(key => key === `${variantOwnerProductId}__${variantId}`));
            }
        } else if (status === 'low-stock-available') {
            // Low stock by availability: SUM(quantity - reservedQuantity) <= threshold
            // Prisma groupBy doesn't support computed fields, so we use a two-step approach
            const allGroups = await prisma.inventoryItem.groupBy({
                by: ['productId', 'variantId'],
                where: groupByWhere,
                _sum: { quantity: true, reservedQuantity: true },
            });
            const filtered = allGroups.filter(g => {
                const totalQty = g._sum.quantity ?? 0;
                const totalReserved = g._sum.reservedQuantity ?? 0;
                const available = Math.max(totalQty - totalReserved, 0);
                return available > 0 && available <= lowStockThreshold;
            });
            lowStockPvKeys = new Set(filtered.map(g => `${g.productId}__${g.variantId || 'none'}`));
            lowStockProductIds = [...new Set(filtered.map(g => g.productId))];
        } else {
            // Low stock by total quantity: SUM(quantity) in (1..threshold)
            const lowStockGroups = await prisma.inventoryItem.groupBy({
                by: ['productId', 'variantId'],
                where: groupByWhere,
                _sum: { quantity: true },
                having: {
                    quantity: { _sum: { gt: 0, lte: lowStockThreshold } }
                }
            });
            lowStockPvKeys = new Set(lowStockGroups.map(g => `${g.productId}__${g.variantId || 'none'}`));
            lowStockProductIds = [...new Set(lowStockGroups.map(g => g.productId))];
        }

        if (lowStockProductIds.length === 0) {
            return { items: [], nextCursor: null };
        }
    }

    // 3. Build product where clause
    const productWhere: any = { productType: { not: 'combo' },};
    if (productId) {
        productWhere.id = productId;
    }
    if (search) {
        productWhere.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } }
        ];
    }

    if (lowStockProductIds) {
        // Low-stock mode: restrict to aggregated low-stock products
        productWhere.id = productId ? productId : { in: lowStockProductIds };
    } else if (!productId) {
        // Active/All mode: use relation existence filter
        const inventoryRelationFilter: any = { ...baseItemWhere };
        delete inventoryRelationFilter.Product;
        delete inventoryRelationFilter.productId;
        delete inventoryRelationFilter.variantId;

        if (status === 'active') {
            inventoryRelationFilter.quantity = { gt: 0 };
        }
        // status === 'all': no quantity filter

        productWhere.InventoryItem = { some: inventoryRelationFilter };
    }

    // 4. Fetch Products (Paginated)
    const products = await prisma.product.findMany({
        where: productWhere,
        select: { id: true, name: true, sku: true, image: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
    });

    const hasMore = products.length > pageSize;
    const slicedProducts = hasMore ? products.slice(0, pageSize) : products;
    const nextCursorId = hasMore ? slicedProducts[slicedProducts.length - 1].id : null;

    if (slicedProducts.length === 0) {
        return { items: [], nextCursor: null };
    }

    const pIds = slicedProducts.map(p => p.id);

    // 5. Fetch ALL inventory items for these products (no qty filter here)
    //    We always fetch all items and aggregate in memory so the UI
    //    sees the correct totals.
    const invWhere: any = {
        ...baseItemWhere,
        productId: { in: pIds }
    };
    // For 'active' mode, skip items with 0 quantity at the DB level for efficiency
    if (status === 'active') {
        invWhere.quantity = { gt: 0 };
    }
    // For 'low-stock', do NOT filter qty at row level — we already filtered by aggregate
    // For 'all', no qty filter

    const items = await prisma.inventoryItem.findMany({
        where: invWhere,
        include: {
            StockLocation: { select: { id: true, name: true } },
            ProductVariant: { select: { id: true, name: true, sku: true, image: true, attributes: true } }
        }
    });

    // 6. Aggregate in Memory (group by product+variant+location)
    const productMap = new Map(slicedProducts.map(p => [p.id, p]));
    const map: Record<string, InventoryItemWithSourceIds> = {};

    for (const row of items) {
        const key = `${row.productId}__${row.variantId || 'none'}__${row.locationId}`;
        const product = productMap.get(row.productId);
        if (!product) continue;

        const rowUnitCost = Number(row.unitCost || 0);
        const rowTotalCost = rowUnitCost * row.quantity;

        if (!map[key]) {
            map[key] = {
                id: row.id,
                productId: row.productId,
                variantId: row.variantId ?? undefined,
                productName: product.name,
                variantName: row.ProductVariant?.name ?? undefined,
                productSku: product.sku ?? undefined,
                variantSku: row.ProductVariant?.sku ?? undefined,
                sku: row.ProductVariant?.sku || product.sku || 'N/A',
                productImage: normalizeUrl(parseProductImage(product.image)),
                variantImage: normalizeUrl(row.ProductVariant?.image) || normalizeUrl(parseProductImage(product.image)),
                variantAttributes: (row.ProductVariant?.attributes as Record<string, string>) ?? undefined,
                quantity: row.quantity,
                reservedQuantity: row.reservedQuantity,
                unitCost: rowUnitCost,
                totalCost: rowTotalCost,
                avgUnitCost: rowUnitCost,
                locationId: row.locationId,
                locationName: row.StockLocation?.name || 'Unknown',
                lotNumber: row.lotNumber,
                receivedDate: row.receivedDate.toISOString(),
                sourceItemIds: [row.id],
            };
        } else {
            map[key].quantity += row.quantity;
            map[key].reservedQuantity += row.reservedQuantity;
            map[key].totalCost = (map[key].totalCost || 0) + rowTotalCost;
            map[key].sourceItemIds.push(row.id);
        }
    }

    const grouped = Object.values(map);

    grouped.forEach((entry) => {
        const qty = entry.quantity || 0;
        const totalCost = Number(entry.totalCost || 0);
        const avg = qty > 0 ? totalCost / qty : 0;
        entry.avgUnitCost = avg;
        entry.unitCost = avg;
    });

    // 7. For out-of-stock mode: synthesize zero-qty entries for products without any inventory rows
    if (isOutOfStockMode) {
        // Look up location name for synthetic entries if a specific location is selected
        let synthLocationId = '';
        let synthLocationName = 'N/A';
        if (locationId && locationId !== 'all') {
            const loc = await prisma.stockLocation.findUnique({
                where: { id: locationId },
                select: { id: true, name: true },
            });
            if (loc) {
                synthLocationId = loc.id;
                synthLocationName = loc.name;
            }
        }

        // If a specific variant is filtered, fetch its details for synthetic entries
        let synthVariant: { id: string; productId: string; name: string | null; sku: string | null; image: string | null; attributes: any } | null = null;
        if (variantId) {
            synthVariant = await prisma.productVariant.findUnique({
                where: { id: variantId },
                select: { id: true, productId: true, name: true, sku: true, image: true, attributes: true },
            });
        }

        for (const product of slicedProducts) {
            // If filtering by a specific variant, only synthesize for its owning product
            if (synthVariant && product.id !== synthVariant.productId) {
                continue;
            }

            const hasItems = grouped.some(i => i.productId === product.id);
            if (!hasItems) {
                grouped.push({
                    id: `synth_${product.id}_${variantId || 'base'}`,
                    productId: product.id,
                    variantId: synthVariant?.id ?? undefined,
                    productName: product.name,
                    variantName: synthVariant?.name ?? undefined,
                    productSku: product.sku ?? undefined,
                    variantSku: synthVariant?.sku ?? undefined,
                    sku: synthVariant?.sku || product.sku || 'N/A',
                    productImage: normalizeUrl(parseProductImage(product.image)),
                    variantImage: normalizeUrl(synthVariant?.image) || normalizeUrl(parseProductImage(product.image)),
                    variantAttributes: (synthVariant?.attributes as Record<string, string>) ?? undefined,
                    quantity: 0,
                    reservedQuantity: 0,
                    unitCost: 0,
                    totalCost: 0,
                    avgUnitCost: 0,
                    locationId: synthLocationId,
                    locationName: synthLocationName,
                    lotNumber: '',
                    receivedDate: new Date().toISOString(),
                    sourceItemIds: [],
                });
            }
        }
    }

    // 8. Sort valid items to match product order
    //    For low-stock mode, filter to only product+variant combos that are truly low
    const orderedItems: InventoryItemWithSourceIds[] = [];
    for (const pid of pIds) {
        let pItems = grouped.filter(i => i.productId === pid);
        if (lowStockPvKeys) {
            pItems = pItems.filter(i => lowStockPvKeys!.has(`${i.productId}__${i.variantId || 'none'}`));
        }
        pItems.sort((a, b) => a.locationName.localeCompare(b.locationName));
        orderedItems.push(...pItems);
    }

    return {
        items: orderedItems,
        nextCursor: nextCursorId
    };
}

// ... existing helpers ...

export async function getInventoryStats(params: {
    search?: string;
    locationId?: string;
    lowStockThreshold?: number; // Added
}) {
    const { search, locationId, lowStockThreshold = 5 } = params;

    const where: any = {};
    if (locationId && locationId !== 'all') {
        where.locationId = locationId;
    }
    if (search) {
        where.OR = [
            { Product: { name: { contains: search, mode: 'insensitive' } } },
            { Product: { sku: { contains: search, mode: 'insensitive' } } },
            { ProductVariant: { name: { contains: search, mode: 'insensitive' } } },
            { ProductVariant: { sku: { contains: search, mode: 'insensitive' } } },
        ];
    }

    // For efficient stats, we fetch minimal fields for ALL matching items and agg in Node
    // This supports global stats (Cost/Sale Value)

    const items = await prisma.inventoryItem.findMany({
        where,
        select: {
            productId: true,
            variantId: true,
            quantity: true,
            reservedQuantity: true,
            unitCost: true,
            Product: { select: { price: true, salePrice: true } },
            ProductVariant: { select: { price: true, salePrice: true } }
        }
    });

    // Step 1: Aggregate per product+variant so stats reflect true product-level counts
    const aggMap = new Map<string, {
        totalQty: number;
        totalReserved: number;
        totalCost: number;
        totalSaleValue: number;
    }>();

    let totalItems = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;
    let allCount = 0;

    for (const item of items) {
        const qty = item.quantity;
        const cost = Number(item.unitCost || 0);
        const salePrice = Number(
            item.ProductVariant?.salePrice ??
            item.ProductVariant?.price ??
            item.Product?.salePrice ??
            item.Product?.price ??
            0
        );

        totalItems += Math.max(qty, 0);
        totalCostValue += Math.max(qty, 0) * cost;
        totalSaleValue += Math.max(qty, 0) * salePrice;

        // Aggregate by product+variant for low-stock counting
        const pvKey = `${item.productId}:${item.variantId || 'none'}`;
        const existing = aggMap.get(pvKey);
        if (existing) {
            existing.totalQty += qty;
            existing.totalReserved += item.reservedQuantity;
            existing.totalCost += qty * cost;
            existing.totalSaleValue += qty * salePrice;
        } else {
            aggMap.set(pvKey, { totalQty: qty, totalReserved: item.reservedQuantity, totalCost: qty * cost, totalSaleValue: qty * salePrice });
        }
    }

    // Step 2: Count active, low-stock, low-stock-available, out-of-stock at product+variant level
    let activeCount = 0;
    let lowStockCount = 0;
    let lowStockAvailableCount = 0;
    let outOfStockCount = 0;
    for (const agg of aggMap.values()) {
        allCount++;
        if (agg.totalQty > 0) {
            activeCount++;
            if (agg.totalQty <= lowStockThreshold) {
                lowStockCount++;
            }
            const available = Math.max(agg.totalQty - agg.totalReserved, 0);
            if (available > 0 && available <= lowStockThreshold) {
                lowStockAvailableCount++;
            }
        } else {
            outOfStockCount++;
        }
    }

    // Step 3: Count products with NO InventoryItem rows as out-of-stock
    //         Respect locationId filter: { none: { locationId } } means
    //         "no inventory at this location" (product may have stock elsewhere)
    const noInvNoneFilter: any = {};
    if (locationId && locationId !== 'all') noInvNoneFilter.locationId = locationId;
    const statsNoInvWhere: any = { InventoryItem: { none: noInvNoneFilter }, productType: { not: 'combo' } };
    if (search) {
        statsNoInvWhere.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
        ];
    }
    const noInvCount = await prisma.product.count({ where: statsNoInvWhere });
    outOfStockCount += noInvCount;
    allCount += noInvCount;

    return {
        active: activeCount,
        lowStock: lowStockCount,
        lowStockAvailable: lowStockAvailableCount,
        outOfStock: outOfStockCount,
        all: allCount,

        totalItems,
        totalCostValue,
        totalSaleValue,
        potentialProfit: totalSaleValue - totalCostValue,
    };
}

// Logic for Audit Items
export async function getAuditItemsPaginated(params: { locationId: string; search?: string; cursor?: string; pageSize?: number }) {
    const { locationId, search, cursor, pageSize = 50 } = params;
    const where: any = { locationId };

    if (search) {
        where.OR = [
            { Product: { name: { contains: search, mode: 'insensitive' } } },
            { Product: { sku: { contains: search, mode: 'insensitive' } } },
            { ProductVariant: { sku: { contains: search, mode: 'insensitive' } } },
            { lotNumber: { contains: search, mode: 'insensitive' } }
        ];
    }

    // P03e: Include images
    const items = await prisma.inventoryItem.findMany({
        where,
        include: {
            Product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    image: true,
                    productType: true,
                    Category: { select: { name: true } }
                }
            },
            ProductVariant: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    image: true
                }
            },
            StockLocation: {
                select: { name: true }
            }
        },
        orderBy: [{ Product: { name: 'asc' } }, { id: 'asc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
    });

    const hasMore = items.length > pageSize;
    const sliced = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    const mapped = sliced.map(row => {
        const prodImg = normalizeUrl(parseProductImage(row.Product?.image));
        const varImg = normalizeUrl(row.ProductVariant?.image);

        return {
            id: row.id,
            productId: row.productId,
            variantId: row.variantId ?? undefined,
            quantity: row.quantity,
            reservedQuantity: row.reservedQuantity,
            locationId: row.locationId,
            locationName: row.StockLocation?.name || 'Unknown',
            lotNumber: row.lotNumber,
            receivedDate: row.receivedDate.toISOString(),
            unitCost: row.unitCost,
            avgUnitCost: row.unitCost, // Fallback
            totalCost: (row.quantity * (row.unitCost || 0)),

            productName: row.Product?.name || 'Unknown Product',
            variantName: row.ProductVariant?.name ?? undefined,

            productSku: row.Product?.sku ?? undefined,
            variantSku: row.ProductVariant?.sku ?? undefined,
            sku: row.ProductVariant?.sku || row.Product?.sku || 'N/A',

            productImage: prodImg,
            variantImage: varImg || prodImg,

            categoryName: row.Product?.Category?.name,
            productType: row.Product?.productType,

            sourceItemIds: [row.id]
        };
    });

    return { items: mapped, nextCursor };
}

// Logic for Lots
export async function getInventoryLotsPaginated(params: {
    productId?: string;
    variantId?: string;
    locationId?: string;
    search?: string;
    cursor?: string;
    pageSize?: number;
}) {
    const { productId, variantId, locationId, search, cursor, pageSize = 50 } = params;
    const where: any = { quantity: { gt: 0 } };

    if (productId) where.productId = productId;
    if (variantId) where.variantId = variantId;
    if (locationId && locationId !== 'all') where.locationId = locationId;
    if (search) {
        where.lotNumber = { contains: search, mode: 'insensitive' };
    }

    const items = await prisma.inventoryItem.findMany({
        where,
        select: {
            id: true,
            productId: true,
            variantId: true,
            quantity: true,
            reservedQuantity: true,
            unitCost: true,
            locationId: true,
            lotNumber: true,
            receivedDate: true,
            Product: { select: { name: true, sku: true } },
            ProductVariant: { select: { name: true, sku: true } },
            StockLocation: { select: { name: true } },
        },
        orderBy: [{ receivedDate: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
    });

    const hasMore = items.length > pageSize;
    const sliced = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    const payload = sliced.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.Product?.name || 'Unknown Product',
        variantName: item.ProductVariant?.name ?? undefined,
        sku: item.ProductVariant?.sku || item.Product?.sku || 'N/A',
        quantity: item.quantity,
        reservedQuantity: item.reservedQuantity ?? 0,
        unitCost: item.unitCost || 0,
        locationId: item.locationId,
        locationName: item.StockLocation.name,
        lotNumber: item.lotNumber,
        receivedDate: item.receivedDate.toISOString(),
        variantId: item.variantId ?? undefined,
    }));

    return { items: payload, nextCursor };
}

// Logic for Movements
export async function getInventoryMovementsPaginated(params: {
    inventoryItemIds?: string[];
    productId?: string;
    variantId?: string;
    locationId?: string;
    cursor?: string;
    pageSize?: number;
}) {
    const { inventoryItemIds, productId, variantId, locationId, cursor, pageSize = 50 } = params;
    const where: any = {};

    if (inventoryItemIds && inventoryItemIds.length > 0) {
        where.inventoryItemId = { in: inventoryItemIds };
    } else if (productId || variantId || locationId) {
        where.InventoryItem = {
            ...(productId ? { productId } : {}),
            ...(variantId ? { variantId } : {}),
            ...(locationId ? { locationId } : {}),
        };
    }

    const movements = await prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        cursor: cursor ? { id: cursor } : undefined,
        include: {
            InventoryItem: {
                select: {
                    id: true,
                    productId: true,
                    variantId: true,
                    locationId: true,
                    lotNumber: true,
                    Product: { select: { name: true, sku: true } },
                    ProductVariant: { select: { name: true, sku: true } },
                    StockLocation: { select: { name: true } },
                },
            },
        },
    });

    const hasMore = movements.length > pageSize;
    const sliced = hasMore ? movements.slice(0, pageSize) : movements;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    const items = sliced.map((mov) => ({
        id: mov.id,
        date: mov.timestamp.toISOString(),
        type: mov.type,
        quantityChange: mov.quantityChange,
        balance: mov.balance,
        notes: mov.notes || '',
        user: mov.user,
        reference: mov.reference || '',
        inventoryItemId: mov.inventoryItemId,
        productId: mov.InventoryItem?.productId,
        variantId: mov.InventoryItem?.variantId ?? undefined,
        locationId: mov.InventoryItem?.locationId,
        locationName: mov.InventoryItem?.StockLocation?.name || '',
        lotNumber: mov.InventoryItem?.lotNumber || '',
        sku: mov.InventoryItem?.ProductVariant?.sku || mov.InventoryItem?.Product?.sku || '',
        productName: mov.InventoryItem?.Product?.name || 'Unknown Product',
        variantName: mov.InventoryItem?.ProductVariant?.name ?? undefined,
    }));

    // Compute historical global balances
    const isProductMode = !variantId; // If variantId is not in params, it's a parent-level or simple product view
    
    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))] as string[];
    const globalRows = productIds.length > 0 ? await prisma.inventoryItem.groupBy({
        by: ['productId', 'variantId'],
        where: { productId: { in: productIds } },
        _sum: { quantity: true },
    }) : [];

    const currentGlobalBalanceProductMap = new Map<string, number>();
    const currentGlobalBalanceVariantMap = new Map<string, number>();

    for (const row of globalRows) {
        if (!row.productId) continue;
        currentGlobalBalanceProductMap.set(row.productId, (currentGlobalBalanceProductMap.get(row.productId) || 0) + (row._sum.quantity || 0));
        const vKey = `${row.productId}:${row.variantId || 'none'}`;
        currentGlobalBalanceVariantMap.set(vKey, (currentGlobalBalanceVariantMap.get(vKey) || 0) + (row._sum.quantity || 0));
    }

    const enrichedItems = await Promise.all(items.map(async (it) => {
        if (!it.productId) return { ...it, globalBalance: 0 };

        let currentGlobalInfo = 0;
        const futureWhere: any = {
            InventoryItem: { productId: it.productId },
            OR: [
                { timestamp: { gt: new Date(it.date) } },
                { timestamp: new Date(it.date), id: { gt: it.id } } // Tie-breaker for identical timestamps
            ]
        };

        if (isProductMode) {
            // Include ALL variants for this product
            currentGlobalInfo = currentGlobalBalanceProductMap.get(it.productId) || 0;
            // futureWhere already correctly scoped to just productId
        } else {
            // Variant mode
            const vKey = `${it.productId}:${it.variantId || 'none'}`;
            currentGlobalInfo = currentGlobalBalanceVariantMap.get(vKey) || 0;
            // Strictly scope to this variant
            futureWhere.InventoryItem.variantId = it.variantId || null;
        }

        // Aggregate future quantity changes
        const futureAgg = await prisma.inventoryMovement.aggregate({
            where: futureWhere,
            _sum: { quantityChange: true }
        });

        const futureChange = futureAgg._sum.quantityChange || 0;
        const historicalGlobalBalance = currentGlobalInfo - futureChange;

        return {
            ...it,
            globalBalance: historicalGlobalBalance
        };
    }));

    return { items: enrichedItems, nextCursor };
}


