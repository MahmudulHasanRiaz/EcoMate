import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateIntegrationApiKey } from "@/server/auth/integration";
import { checkRateLimit, getRateLimitHeaders } from "@/server/modules/rate-limiter";
import { normalizeBdPhoneForStorage } from "@/lib/phone";
import { buildCorsHeaders, corsOptionsResponse } from "@/server/utils/cors";
import crypto from "crypto";

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

    if (!integration.incompleteEnabled) {
      return NextResponse.json(
        { success: true, ignored: true, reason: "incomplete-disabled" },
        { headers: corsHeaders }
      );
    }

    const rl = await checkRateLimit(`incomplete:${integration.id}`, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded" },
        { status: 429, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
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

    const phone = payload.phone || payload.customer?.phone || "";
    const name = payload.name || payload.customer?.name || "";
    const address = payload.address || payload.customer?.address || "";
    const skuList = Array.isArray(payload.skuList)
      ? payload.skuList.slice(0, 100)
      : Array.isArray(payload.items)
      ? payload.items.map((i: any) => i.sku || i.name || "").filter(Boolean).slice(0, 100)
      : [];
    const landingPage = payload.landingPage || payload.url || "";
    const userAgent = payload.userAgent || req.headers.get("user-agent") || "";

    const phoneNormalized = normalizeBdPhoneForStorage(phone);
    const normalizedPhone = phoneNormalized.value || "";

    const fingerprintRaw = [
      normalizedPhone,
      (skuList || []).join(","),
    ].join("|");
    const fingerprint = crypto.createHash("sha256").update(fingerprintRaw).digest("hex");
    const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "unknown";
    const ipHash = crypto.createHash("sha256").update(ipRaw).digest("hex");

    const existing = await prisma.wooCheckoutLead.findFirst({
      where: { fingerprint, integrationId: integration.id },
      select: { id: true, occurrences: true },
    });

    if (existing) {
      await prisma.wooCheckoutLead.update({
        where: { id: existing.id },
        data: {
          occurrences: existing.occurrences + 1,
          lastSeenAt: new Date(),
          payload: payload as any,
          userAgent,
        },
      });
      return NextResponse.json(
        { success: true, updated: true, leadId: existing.id },
        { headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
      );
    }

    const uid = `inc_${crypto.randomBytes(8).toString("hex")}`;
    await prisma.wooCheckoutLead.create({
      data: {
        id: uid,
        integrationId: integration.id,
        businessId: integration.businessId,
        uid,
        phoneNormalized: normalizedPhone,
        name,
        address,
        skuList: skuList as any,
        payload: payload as any,
        status: "OPEN",
        occurrences: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        fingerprint,
        ipHash,
        userAgent,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: true, leadId: uid },
      { status: 201, headers: mergeHeaders(corsHeaders, getRateLimitHeaders(rl.remaining, 60, rl.resetAt)) }
    );
  } catch (err: any) {
    console.error("[V1_INCOMPLETE_ERR]", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
