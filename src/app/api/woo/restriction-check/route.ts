
import { NextRequest, NextResponse } from "next/server";
import { validateWooApiKey } from "@/server/auth/woo";
import prisma from "@/lib/prisma";
import { normalizeBdPhone } from "@/lib/utils/phone-utils";
import { createHash } from "crypto";

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

function hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex');
}

async function resolveSupportPhone(integration: any) {
    if (integration.restrictionSupportPhone) return integration.restrictionSupportPhone;
    if (integration.supportPhone) return integration.supportPhone;

    // Fallback to business
    if (integration.business?.phone) return integration.business.phone;

    // Fallback to general settings
    try {
        const general = await prisma.appSetting.findUnique({ where: { key: 'general' } });
        const settings = general?.value as any;
        return settings?.supportPhone || settings?.phone || "";
    } catch {
        return "";
    }
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
    } catch (e) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders });
    }

    const { phone, uid } = body;

    const normalizedPhone = normalizeBdPhone(phone);
    if (!normalizedPhone) {
        return NextResponse.json({
            allowed: false,
            reason: "invalid_phone",
            message: "Invalid phone number.",
            supportPhone: await resolveSupportPhone(integration)
        }, { headers: corsHeaders });
    }

    // IP Check (Global) - Prioritize explicit IP from body (trusted via API key)
    let ip = body.ip || req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || (req as any).ip || "";
    if (ip.includes(',')) ip = ip.split(',')[0].trim();

    if (ip) {
        const ipHash = hashIp(ip);
        const ipRestriction = await prisma.orderRestriction.findFirst({
            where: {
                targetType: 'IP',
                targetHash: ipHash,
                expiresAt: { gt: new Date() }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (ipRestriction) {
            return NextResponse.json({
                allowed: false,
                reason: "ip_blocked",
                message: ipRestriction.message || integration.restrictionMessage || "Restricted (IP)",
                supportPhone: ipRestriction.supportPhone || await resolveSupportPhone(integration)
            }, { headers: corsHeaders });
        }
    }

    // Phone Check
    const scopeSetting = (integration.restrictionScope || 'site').toLowerCase();

    let phoneWhere: any = {
        targetType: 'PHONE',
        targetHash: normalizedPhone,
        expiresAt: { gt: new Date() }
    };

    if (scopeSetting === 'site') {
        // match integrationId only (Strict isolation as per instructions)
        phoneWhere.integrationId = integration.id;
    } else {
        // global: match any integration
    }

    const phoneRestriction = await prisma.orderRestriction.findFirst({
        where: phoneWhere,
        orderBy: { createdAt: 'desc' }
    });

    if (phoneRestriction) {
        return NextResponse.json({
            allowed: false,
            reason: "phone_blocked",
            blockType: 'PHONE',
            message: integration.restrictionMessage || phoneRestriction.message || "Restricted",
            supportPhone: integration.restrictionSupportPhone || phoneRestriction.supportPhone || await resolveSupportPhone(integration)
        }, { headers: corsHeaders });
    }

    return NextResponse.json({ allowed: true }, { headers: corsHeaders });
}
