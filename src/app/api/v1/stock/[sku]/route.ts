import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateIntegrationApiKey } from "@/server/auth/integration";
import { checkRateLimit, getRateLimitHeaders } from "@/server/modules/rate-limiter";
import { buildCorsHeaders, corsOptionsResponse } from "@/server/utils/cors";

function mergeHeaders(...hs: Record<string, string>[]) {
    const merged: Record<string, string> = {};
    for (const h of hs) Object.assign(merged, h);
    return merged;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
    return corsOptionsResponse(req);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  const corsHeaders = buildCorsHeaders(req);

  try {
    const integration = await validateIntegrationApiKey(req);
    if (!integration) return NextResponse.json(
      { success: false, message: "Invalid or missing API key" },
      { status: 401, headers: corsHeaders }
    );

    const rl = await checkRateLimit(`stock:${integration.id}`, 120);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        { status: 429, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 120, rl.resetAt)) }
      );
    }

    const { sku } = await params;
    if (!sku || sku.length > 100) {
      return NextResponse.json(
        { success: false, message: "Invalid SKU" },
        { status: 400, headers: corsHeaders }
      );
    }

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: { equals: sku, mode: "insensitive" } },
          { variants: { some: { sku: { equals: sku, mode: "insensitive" } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        salePrice: true,
        isPublished: true,
        inventory: true,
        variants: {
          select: { id: true, name: true, sku: true, price: true, salePrice: true },
          take: 20,
        },
        InventoryItem: {
          select: { quantity: true, reservedQuantity: true },
        },
      },
    });

    if (!product) return NextResponse.json(
      { success: false, message: `Product with SKU "${sku}" not found` },
      { status: 404, headers: corsHeaders }
    );

    const totalQuantity = product.InventoryItem.reduce((s, st) => s + st.quantity, 0);
    const totalReserved = product.InventoryItem.reduce((s, st) => s + st.reservedQuantity, 0);
    const available = totalQuantity - totalReserved;
    const stockStatus =
      !product.isPublished ? "unpublished" : available > 0 ? "in_stock" : "out_of_stock";

    return NextResponse.json(
      {
        success: true,
        data: {
          sku: product.sku,
          name: product.name,
          price: Number(product.price),
          salePrice: product.salePrice ? Number(product.salePrice) : null,
          isPublished: product.isPublished,
          inventory: product.inventory,
          stockQuantity: totalQuantity,
          stockReserved: totalReserved,
          stockAvailable: available,
          stockStatus,
          variants: product.variants.map(v => ({
            sku: v.sku,
            name: v.name,
            price: Number(v.price),
            salePrice: v.salePrice ? Number(v.salePrice) : null,
          })),
        },
      },
      { headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 120, rl.resetAt)) }
    );
  } catch (err: any) {
    console.error("[V1_STOCK_ERR]", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
