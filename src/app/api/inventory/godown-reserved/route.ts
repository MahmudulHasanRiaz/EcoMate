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
    // Optional: filter by product type if needed in future
    // const productType = searchParams.get('productType');

    // 1. Resolve Locations (case-insensitive)
    const [godown, packing] = await Promise.all([
      prisma.stockLocation.findFirst({ where: { name: { equals: 'Godown', mode: 'insensitive' } } }),
      prisma.stockLocation.findFirst({ where: { name: { equals: 'Packing Section', mode: 'insensitive' } } }),
    ]);

    const godownId = godown?.id;
    const packingId = packing?.id;

    if (!godownId || !packingId) {
      return apiError('Godown or Packing Section location not found', 400, { code: 'LOCATIONS_NOT_FOUND' });
    }

    // 2. Find eligible products (reserved in Godown > 0)
    // We use raw sql or groupBy. We need to optionally filter by search.
    // groupBy doesn't natively allow searching across relations, so we might need two steps if searching.

    let eligiblePVs: Array<{ productId: string, variantId: string | null }> = [];

    // Step A: Get all groups that meet the criteria
    const groups = await prisma.inventoryItem.groupBy({
      by: ['productId', 'variantId'],
      where: {
        locationId: godownId,
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

    // Pagination over identical array
    const totalCount = eligiblePVs.length;
    const start = (page - 1) * pageSize;
    const paginatedPVs = eligiblePVs.slice(start, start + pageSize);

    if (paginatedPVs.length === 0) {
      return apiSuccess({ data: [], meta: { total: totalCount, page, pageSize } });
    }

    // Prepare arrays for querying items and products
    const pIds = Array.from(new Set(paginatedPVs.map(p => p.productId)));

    // 3. Fetch full product and variant details
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

    // 4. Fetch Inventory quantities for BOTH Godown and Packing for the paginated PVs
    const pvConditions = paginatedPVs.map(pv => ({
      productId: pv.productId,
      ...(pv.variantId ? { variantId: pv.variantId } : { variantId: null })
    }));

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        locationId: { in: [godownId, packingId] },
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
    const godownInvItemIds = inventoryItems.filter(i => i.locationId === godownId).map(i => i.id);

    // Fetch allocations for ordersCount computation
    const allocations = godownInvItemIds.length > 0 ? await prisma.orderStockAllocation.findMany({
      where: {
        inventoryItemId: { in: godownInvItemIds },
        action: 'reserve',
        quantity: { gt: 0 }
      },
      select: { orderId: true, productId: true, variantId: true }
    }) : [];

    // 5. Aggregate logic & Format Output
    const responseData = paginatedPVs.map(pv => {
      const product = productMap.get(pv.productId);
      const variant = product?.variants.find(v => v.id === pv.variantId) || null;

      // Filter invItems for this pv
      const items = inventoryItems.filter(i => 
        i.productId === pv.productId && (i.variantId || null) === pv.variantId
      );

      const godownItems = items.filter(i => i.locationId === godownId);
      const packingItems = items.filter(i => i.locationId === packingId);

      const godownTotal = godownItems.reduce((acc, i) => acc + i.quantity, 0);
      const godownReserved = godownItems.reduce((acc, i) => acc + i.reservedQuantity, 0);
      const godownAvailable = Math.max(godownTotal - godownReserved, 0);

      const packingTotal = packingItems.reduce((acc, i) => acc + i.quantity, 0);
      const packingReserved = packingItems.reduce((acc, i) => acc + i.reservedQuantity, 0);
      const packingAvailable = Math.max(packingTotal - packingReserved, 0);

      // distinct orders targeting this specific PV from Godown
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

        godown: {
          total: godownTotal,
          reserved: godownReserved,
          available: godownAvailable
        },
        packing: {
          total: packingTotal,
          reserved: packingReserved,
          available: packingAvailable
        },
        
        reservedInGodown: godownReserved,
        recommendedTransferQty: godownReserved,
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
    console.error('[API_GODOWN_RESERVED]', error);
    return apiServerError(error);
  }
}
