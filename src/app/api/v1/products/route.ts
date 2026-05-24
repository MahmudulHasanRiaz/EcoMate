import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateIntegrationApiKey } from "@/server/auth/integration";
import { checkRateLimit, getRateLimitHeaders } from "@/server/modules/rate-limiter";
import { getRedisClient } from "@/server/queues/redis";
import { buildCorsHeaders, corsOptionsResponse } from "@/server/utils/cors";

function mergeHeaders(...hs: Record<string, string>[]) {
    const merged: Record<string, string> = {};
    for (const h of hs) Object.assign(merged, h);
    return merged;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_S = 30;

async function getCachedOrFetch(cacheKey: string, fetcher: () => Promise<any>) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* fall through */ }
  }
  const data = await fetcher();
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(data), "EX", CACHE_TTL_S);
    } catch { /* silent */ }
  }
  return data;
}

export function OPTIONS(req: NextRequest) {
    return corsOptionsResponse(req);
}

export async function GET(req: NextRequest) {
  const corsHeaders = buildCorsHeaders(req);

  try {
    const integration = await validateIntegrationApiKey(req);
    if (!integration) return NextResponse.json(
      { success: false, message: "Invalid or missing API key" },
      { status: 401, headers: corsHeaders }
    );

    const rl = await checkRateLimit(`products:${integration.id}`, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        { status: 429, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
      );
    }

    const url = req.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
    const skuFilter = url.searchParams.get("sku") || "";
    const search = url.searchParams.get("search") || "";

    const cacheKey = `v1:products:${integration.businessId}:${page}:${limit}:${skuFilter}:${search}`;

    const data = await getCachedOrFetch(cacheKey, async () => {
      const where: any = {};
      if (skuFilter) {
        where.OR = [
          { sku: { contains: skuFilter, mode: "insensitive" } },
          { variants: { some: { sku: { contains: skuFilter, mode: "insensitive" } } } },
        ];
      }
      if (search) {
        where.name = { contains: search, mode: "insensitive" };
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            salePrice: true,
            productType: true,
            image: true,
            isPublished: true,
            inventory: true,
            variants: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                salePrice: true,
              },
              take: 20,
            },
            InventoryItem: {
              select: {
                quantity: true,
                reservedQuantity: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.product.count({ where }),
      ]);

      const items = products.map(p => {
        const totalQuantity = p.InventoryItem.reduce((s, st) => s + st.quantity, 0);
        const totalReserved = p.InventoryItem.reduce((s, st) => s + st.reservedQuantity, 0);
        const availableQuantity = totalQuantity - totalReserved;
        const stockStatus =
          !p.isPublished ? "unpublished" : availableQuantity > 0 ? "in_stock" : "out_of_stock";

        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: Number(p.price),
          salePrice: p.salePrice ? Number(p.salePrice) : null,
          productType: p.productType,
          image: p.image,
          isPublished: p.isPublished,
          inventory: p.inventory,
          stockQuantity: totalQuantity,
          stockReserved: totalReserved,
          stockAvailable: availableQuantity,
          stockStatus,
          variants: p.variants.map(v => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            price: Number(v.price),
            salePrice: v.salePrice ? Number(v.salePrice) : null,
          })),
        };
      });

      return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    });

    return NextResponse.json(
      { success: true, data },
      { headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
    );
  } catch (err: any) {
    console.error("[V1_PRODUCTS_ERR]", err);
    return NextResponse.json(
      { success: false, message: "Failed to fetch products" },
      { status: 500, headers: corsHeaders }
    );
  }
}
