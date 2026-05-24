import { NextRequest, NextResponse } from "next/server";
import { validateIntegrationApiKey } from "@/server/auth/integration";
import { processGenericOrder } from "@/server/modules/generic-order-processor";
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

export async function POST(req: NextRequest) {
  const corsHeaders = buildCorsHeaders(req);

  try {
    const integration = await validateIntegrationApiKey(req);
    if (!integration) return NextResponse.json(
      { success: false, message: "Invalid or missing API key" },
      { status: 401, headers: corsHeaders }
    );

    const rl = await checkRateLimit(`orders:${integration.id}`, 120);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        { status: 429, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 120, rl.resetAt)) }
      );
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!payload.externalOrderId || !payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      return NextResponse.json(
        { success: false, message: "externalOrderId and items array are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await processGenericOrder(integration, payload);
    if (result.alreadyExists) {
      return NextResponse.json(
        { success: true, message: "Order already exists", orderId: result.orderId },
        { headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 120, rl.resetAt)) }
      );
    }
    return NextResponse.json(
      { success: true, message: "Order received", orderId: result.orderId },
      { status: 201, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 120, rl.resetAt)) }
    );
  } catch (err: any) {
    console.error("[V1_ORDERS_POST_ERR]", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
