
import { NextRequest, NextResponse } from "next/server";
import { validateWooApiKey } from "@/server/auth/woo";
import prisma from "@/lib/prisma";
import { getRedisClient } from '@/server/queues/redis';
import { normalizeBdPhone } from "@/lib/utils/phone-utils";
import crypto from "crypto";

// This file is a placeholder destination for the rewrite
// However, since we are using rewrites to point to /api/woo/incomplete-orders/complete
// We actually need the GLOBAL route to exist.
// Checking my previous steps, I created the compatibility route in [id]/incomplete-orders/complete/route.ts
// But per the plan, I should create the GLOBAL one: src/app/api/woo/incomplete-orders/complete/route.ts

const RECENT_COMPLETION_TTL_SEC = 30 * 60;
const recentCompletionMap = new Map<string, number>();

function completionKey(integrationId: string, phone: string) {
    return `woo:lead:completed:${integrationId}:${phone}`;
}

async function markRecentCompletion(integrationId: string, phone: string) {
    const key = completionKey(integrationId, phone);
    recentCompletionMap.set(key, Date.now());
    try {
        const redis = getRedisClient();
        if (redis) {
            await redis.set(key, '1', 'EX', RECENT_COMPLETION_TTL_SEC);
        }
    } catch (e) {
        console.error('[WOO_COMPLETE_RECENT_COMPLETION_REDIS_ERR]', e);
    }
}

function buildCorsHeaders(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

export function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: buildCorsHeaders(req) });
}

export async function POST(req: NextRequest) {
    const corsHeaders = buildCorsHeaders(req);
    const integration = await validateWooApiKey(req);

    if (!integration) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders });
    }

    const { phone, order_id } = body;
    const normalizedPhone = normalizeBdPhone(phone);
    if (!normalizedPhone) {
        return NextResponse.json({ status: "skipped", reason: "invalid_phone" }, { headers: corsHeaders });
    }

    // 1. Mark existing open leads as COMPLETED globally by phone.
    // If order exists anywhere in panel, that phone should not remain OPEN in incomplete queue.
    await prisma.wooCheckoutLead.updateMany({
        where: {
            phoneNormalized: normalizedPhone,
            status: 'OPEN'
        },
        data: {
            status: 'COMPLETED',
            completedAt: new Date()
        }
    });

    await markRecentCompletion(integration.id, normalizedPhone);

    // 2. Create Restriction on Success (if configured)
    if (integration.restrictionEnabled) {
        let expiresAt: Date | null = null;
        const durValue = integration.restrictionDurationValue || 0;
        const durType = (integration.restrictionDurationType || 'always').toLowerCase();

        if (durType === 'hours' && durValue > 0) {
            expiresAt = new Date(Date.now() + durValue * 3600000);
        } else if (durType === 'days' && durValue > 0) {
            expiresAt = new Date(Date.now() + durValue * 86400000);
        } else if (durType === 'always') {
            expiresAt = new Date(Date.now() + 3650 * 86400000); // 10 years
        }

        if (expiresAt) {
            let message = integration.restrictionMessage || "Order successful! Temporary cooling period.";
            let supportPhone = integration.restrictionSupportPhone || integration.supportPhone || "";

            if (!supportPhone && integration.businessId) {
                const biz = await prisma.business.findUnique({ where: { id: integration.businessId } });
                if (biz?.phone) supportPhone = biz.phone;
            }

            try {
                // Find any EXISTING and ACTIVE restriction for this phone + site
                const existing = await prisma.orderRestriction.findFirst({
                    where: {
                        targetType: 'PHONE',
                        targetHash: normalizedPhone,
                        scope: 'SITE',
                        integrationId: integration.id,
                        expiresAt: { gt: new Date() }
                    }
                });

                if (existing) {
                    await prisma.orderRestriction.update({
                        where: { id: existing.id },
                        data: {
                            expiresAt,
                            message,
                            supportPhone,
                            sourceOrderId: order_id ? String(order_id) : existing.sourceOrderId,
                            updatedAt: new Date()
                        }
                    });
                } else {
                    await prisma.orderRestriction.create({
                        data: {
                            id: `res_${crypto.randomBytes(12).toString('hex')}`,
                            targetType: 'PHONE',
                            targetHash: normalizedPhone,
                            scope: 'SITE',
                            integrationId: integration.id,
                            businessId: integration.businessId,
                            message,
                            supportPhone,
                            expiresAt,
                            sourceOrderId: order_id ? String(order_id) : null,
                            updatedAt: new Date()
                        }
                    });
                }
            } catch (e) {
                console.error('[WooCompleteRestriction]', e);
            }
        }
    }

    return NextResponse.json({ status: "processed" }, { headers: corsHeaders });
}
