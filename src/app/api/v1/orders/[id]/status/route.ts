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
  { params }: { params: Promise<{ id: string }> }
) {
  const corsHeaders = buildCorsHeaders(req);

  try {
    const integration = await validateIntegrationApiKey(req);
    if (!integration) return NextResponse.json(
      { success: false, message: "Invalid or missing API key" },
      { status: 401, headers: corsHeaders }
    );

    const rl = await checkRateLimit(`status:${integration.id}`, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        { status: 429, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
      );
    }

    const { id: externalOrderId } = await params;
    if (!externalOrderId || externalOrderId.length > 100) {
      return NextResponse.json(
        { success: false, message: "Invalid order ID" },
        { status: 400, headers: corsHeaders }
      );
    }

    const internalOrderId = `${integration.platform || "site"}-${integration.id}-${externalOrderId}`;

    const order = await prisma.order.findUnique({
      where: { id: internalOrderId },
      select: {
        id: true,
        status: true,
        total: true,
        customerName: true,
        customerPhone: true,
        courierMeta: true,
        courierService: true,
        courierConsignmentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!order) return NextResponse.json(
      { success: false, message: "Order not found" },
      { status: 404, headers: corsHeaders }
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          externalOrderId,
          status: order.status,
          total: order.total,
          customerName: order.customerName,
          courierService: order.courierService,
          courierConsignmentId: order.courierConsignmentId,
          courierMeta: order.courierMeta,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
      },
      { headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
    );
  } catch (err: any) {
    console.error("[V1_ORDER_STATUS_ERR]", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
