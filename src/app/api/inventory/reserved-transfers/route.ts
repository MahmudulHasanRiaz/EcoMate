import { NextRequest } from "next/server";
import { apiError, apiServerError, apiSuccess } from "@/lib/error";
import { enforcePermission } from "@/lib/security";
import prisma from '@/lib/prisma';

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

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission("inventory", "read");
    if (!allowed) return error;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    
    // Dynamic Location Resolution
    let fromLocationId = searchParams.get('fromLocationId');
    if (!fromLocationId) {
        const godown = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Godown', mode: 'insensitive' } } });
        fromLocationId = godown?.id || null;
    }
    
    const packing = await prisma.stockLocation.findFirst({ where: { name: { equals: 'Packing Section', mode: 'insensitive' } } });
    const toLocationId = searchParams.get('toLocationId') || packing?.id;

    if (!fromLocationId || !toLocationId) {
      return apiError('Source or Destination location not found', 400, { code: 'LOCATIONS_NOT_FOUND' });
    }

    // 2. Find eligible products (reserved in Source Location > 0)
    let eligiblePVs: Array<{ productId: string, variantId: string | null }> = [];

    const groups = await prisma.inventoryItem.groupBy({
      by: ['productId', 'variantId'],
      where: {
        locationId: fromLocationId,
      },
      _sum: { reservedQuantity: true },
    });

    const reservedGroups = groups.filter(g => (g._sum.reservedQuantity || 0) > 0);

    // Step B: Apply search filter
    if (search) {
      const [matchingProducts, matchingVariants] = await Promise.all([
        prisma.product.findMany({
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        }),
        prisma.productVariant.findMany({
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true, productId: true },
        }),
      ]);

      const matchingProductIds = new Set(matchingProducts.map((p) => p.id));
      const matchingVariantIds = new Set(matchingVariants.map((v) => v.id));

      eligiblePVs = reservedGroups
        .filter((g) => {
          if (matchingProductIds.has(g.productId)) return true;
          return g.variantId ? matchingVariantIds.has(g.variantId) : false;
        })
        .map((g) => ({ productId: g.productId, variantId: g.variantId || null }));
    } else {
      eligiblePVs = reservedGroups.map(g => ({
        productId: g.productId,
        variantId: g.variantId || null
      }));
    }

    const totalCount = eligiblePVs.length;
    const start = (page - 1) * pageSize;
    const paginatedPVs = eligiblePVs.slice(start, start + pageSize);

    if (paginatedPVs.length === 0) {
      return apiSuccess({ data: [], meta: { total: totalCount, page, pageSize } });
    }

    const pIds = Array.from(new Set(paginatedPVs.map(p => p.productId)));

    const products = await prisma.product.findMany({
      where: { id: { in: pIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        image: true,
        productType: true,
        variants: {
          select: { id: true, name: true, sku: true, image: true, attributes: true }
        }
      }
    });

    const productMap = new Map(products.map(p => [p.id, p]));

    const pvConditions = paginatedPVs.map(pv => ({
      productId: pv.productId,
      ...(pv.variantId ? { variantId: pv.variantId } : { variantId: null })
    }));

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        locationId: { in: [fromLocationId, toLocationId] },
        OR: pvConditions
      },
      select: {
        id: true,
        productId: true,
        variantId: true,
        locationId: true,
        quantity: true,
        reservedQuantity: true,
      }
    });
    
    const sourceInvItemIds = inventoryItems.filter(i => i.locationId === fromLocationId).map(i => i.id);

    const allocations = sourceInvItemIds.length > 0 ? await prisma.orderStockAllocation.findMany({
      where: {
        inventoryItemId: { in: sourceInvItemIds },
        action: 'reserve',
        quantity: { gt: 0 }
      },
      select: { orderId: true, productId: true, variantId: true }
    }) : [];

    const responseData = paginatedPVs.map(pv => {
      const product = productMap.get(pv.productId);
      const variant = product?.variants.find(v => v.id === pv.variantId) || null;

      const items = inventoryItems.filter(i => 
        i.productId === pv.productId && (i.variantId || null) === pv.variantId
      );

      const sourceItems = items.filter(i => i.locationId === fromLocationId);
      const destItems = items.filter(i => i.locationId === toLocationId);

      const sourceTotal = sourceItems.reduce((acc, i) => acc + i.quantity, 0);
      const sourceReserved = sourceItems.reduce((acc, i) => acc + i.reservedQuantity, 0);
      const sourceAvailable = Math.max(sourceTotal - sourceReserved, 0);

      const destTotal = destItems.reduce((acc, i) => acc + i.quantity, 0);
      const destReserved = destItems.reduce((acc, i) => acc + i.reservedQuantity, 0);
      const destAvailable = Math.max(destTotal - destReserved, 0);

      const pvAllocs = allocations.filter(a => a.productId === pv.productId && (a.variantId || null) === pv.variantId);
      const orderSet = new Set(pvAllocs.map(a => a.orderId));
      const ordersCount = orderSet.size;

      return {
        key: `${pv.productId}_${pv.variantId || 'null'}`,
        productId: pv.productId,
        variantId: pv.variantId || undefined,
        productName: product?.name || 'Unknown',
        productSku: product?.sku || 'Unknown',
        productType: product?.productType || 'simple',
        productImage: normalizeUrl(parseProductImage(product?.image)),
        
        variantName: variant?.name || undefined,
        variantSku: variant?.sku || undefined,
        variantImage: normalizeUrl(variant?.image),

        fromLocation: {
          total: sourceTotal,
          reserved: sourceReserved,
          available: sourceAvailable
        },
        toLocation: {
          total: destTotal,
          reserved: destReserved,
          available: destAvailable
        },
        
        reservedInGodown: sourceReserved, // Legacy param name for React components
        reservedInSource: sourceReserved,
        recommendedTransferQty: sourceReserved,
        ordersCount,
      };
    });

    return apiSuccess({
      data: responseData,
      meta: {
        total: totalCount,
        page,
        pageSize
      }
    });
  } catch (error: any) {
    console.error('[API_RESERVED_TRANSFERS]', error);
    return apiServerError(error);
  }
}
