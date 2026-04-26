
import { NextRequest, NextResponse } from "next/server";
import { validateWooApiKey } from "@/server/auth/woo";
import prisma from "@/lib/prisma";
import { normalizeBdPhone } from "@/lib/utils/phone-utils";
import { createHash } from "crypto";
import { getRedisClient } from '@/server/queues/redis';

const RECENT_COMPLETION_TTL_SEC = 30 * 60; // 30 minutes
const recentCompletionMap = new Map<string, number>();

function completionKey(integrationId: string, phone: string) {
    return `woo:lead:completed:${integrationId}:${phone}`;
}

async function hasRecentCompletion(integrationId: string, phone: string, integration: any) {
    const now = Date.now();
    const key = completionKey(integrationId, phone);
    const cutoff = new Date(now - RECENT_COMPLETION_TTL_SEC * 1000);

    const mem = recentCompletionMap.get(key);
    if (mem && now - mem < RECENT_COMPLETION_TTL_SEC * 1000) return true;

    try {
        const redis = getRedisClient();
        if (redis) {
            const v = await redis.get(key);
            if (v) return true;
        }
    } catch (e) {
        console.error('[WOO_INCOMPLETE_RECENT_COMPLETION_REDIS_ERR]', e);
    }

    // DB fallback: recent terminal lead (completed, converted, or cancelled)
    const recentCompletedLead = await prisma.wooCheckoutLead.findFirst({
        where: {
            integrationId,
            phoneNormalized: phone,
            status: { in: ['COMPLETED', 'CONVERTED', 'CANCELLED', 'NOT_CONVERTED'] },
            OR: [
                { completedAt: { gt: cutoff } },
            ],
        },
        select: { id: true },
    });
    if (recentCompletedLead) return true;

    // DB fallback: if a real order already exists for this phone, do not keep/open incomplete lead.
    // Enforced globally across businesses to prevent duplicate flows.
    const existingOrder = await prisma.order.findFirst({
        where: {
            customerPhone: phone,
            status: { notIn: ['Canceled', 'C2C', 'Incomplete_Cancelled'] as any },
        },
        select: { id: true, status: true },
    });
    return !!existingOrder;
}

async function resolveIntegrationFromRequest(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    if (!token) {
        token = req.nextUrl.searchParams.get('apiKey');
    }
    if (!token) return null;

    const integration = await prisma.wooCommerceIntegration.findUnique({
        where: { apiKey: token },
        include: { business: true },
    });
    return integration;
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

function hashString(str: string): string {
    return createHash('sha256').update(str).digest('hex');
}

export async function POST(req: NextRequest) {
    const corsHeaders = buildCorsHeaders(req);
    const integration = await resolveIntegrationFromRequest(req);
    if (!integration) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    if (!integration.incompleteEnabled) {
        return NextResponse.json({ message: "Feature disabled" }, { status: 200, headers: corsHeaders });
    }

    let body: any = {};
    try {
        const raw = await req.text();
        if (raw) {
            try {
                body = JSON.parse(raw);
            } catch {
                const params = new URLSearchParams(raw);
                body = Object.fromEntries(params.entries());
            }
        }
    } catch (e) {
        console.error('[WooIncomplete:PARSE]', e);
        return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: corsHeaders });
    }

    if (body?.debug === true) {
        console.log('[WOO_INCOMPLETE_DEBUG_OK]', integration.id);
        return NextResponse.json({ status: 'debug-ok' }, { headers: corsHeaders });
    }

    console.log('[WOO_INCOMPLETE_HIT]', integration.id, body?.phone ? 'hasPhone' : 'noPhone');

    const { phone, uid, name, address, skuList, payload } = body;

    const normalizedPhone = normalizeBdPhone(phone);
    if (!normalizedPhone) {
        return NextResponse.json({ error: "Invalid phone" }, { status: 400, headers: corsHeaders });
    }

    // Guard: skip incomplete if this phone was completed recently
    const recentCompletion = await hasRecentCompletion(integration.id, normalizedPhone, integration);
    if (recentCompletion) {
        return NextResponse.json(
            { status: 'skipped_recent_completion' },
            { headers: corsHeaders }
        );
    }

    // IP
    let ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || (req as any).ip || "";
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    const ipHash = ip ? hashString(ip) : null;

    // Fingerprint
    const skuString = JSON.stringify(skuList || []);
    const addrString = (address || "").trim().toLowerCase();
    const fingerprintRaw = `${integration.id}:${normalizedPhone}:${skuString}:${addrString}`;
    const fingerprint = hashString(fingerprintRaw);

    try {
        // v1.7: Try to find open lead by Session ID (uid) first (to handle phone/address changes in same session)
        let existing = null;
        if (uid) {
            existing = await prisma.wooCheckoutLead.findFirst({
                where: {
                    integrationId: integration.id,
                    uid: uid,
                    status: 'OPEN'
                },
                orderBy: { updatedAt: 'desc' }
            });
        }

        if (!existing) {
            existing = await prisma.wooCheckoutLead.findUnique({
                where: { fingerprint }
            });
        }

        if (existing) {
            const dedupeMinutes = integration.dedupeMinutes || 10;
            const isWithinWindow = (new Date().getTime() - existing.lastSeenAt.getTime()) < (dedupeMinutes * 60 * 1000);

            if (isWithinWindow) {
                const lead = await prisma.wooCheckoutLead.update({
                    where: { id: existing.id },
                    data: {
                        lastSeenAt: new Date(),
                        ipHash: ipHash,
                        status: 'OPEN',
                        occurrences: { increment: 1 },
                        uid: uid || undefined,
                        payload: payload || undefined,
                        name: name || undefined,
                        address: address || undefined,
                        skuList: skuList || undefined,
                        phoneNormalized: normalizedPhone, // Ensure phone is updated
                        fingerprint: fingerprint      // Ensure fingerprint matches current data
                    }
                });
                return NextResponse.json({ status: "success", id: lead.id, action: "updated", dedupe: true }, { headers: corsHeaders });
            } else {
                // Outside window -> "Archive" old fingerprint and create new lead
                await prisma.wooCheckoutLead.update({
                    where: { id: existing.id },
                    data: { fingerprint: `${fingerprint}:expired:${Date.now()}` }
                });
                // Fall through to create new lead below
            }
        }

        const lead = await prisma.wooCheckoutLead.create({
            data: {
                integrationId: integration.id,
                businessId: integration.businessId,
                uid: uid || "",
                phoneNormalized: normalizedPhone,
                name: name || "",
                address: address || "",
                skuList: skuList || [],
                payload: payload || {},
                ipHash,
                fingerprint,
                status: 'OPEN',
                occurrences: 1,
                lastSeenAt: new Date(),
                firstSeenAt: new Date(),
                userAgent: req.headers.get("user-agent") || ""
            }
        });
        return NextResponse.json({ status: "success", id: lead.id, action: "created" }, { headers: corsHeaders });
    } catch (e) {
        console.error('[WooIncomplete]', e);
        return NextResponse.json({ error: "Database error" }, { status: 500, headers: corsHeaders });
    }
}
