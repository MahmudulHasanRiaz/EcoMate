
import { NextRequest, NextResponse } from "next/server";
import { validateWooApiKey } from "@/server/auth/woo";
import prisma from "@/lib/prisma";

function buildCorsHeaders(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Requested-With",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

export function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: buildCorsHeaders(req) });
}

export async function GET(req: NextRequest) {
    const corsHeaders = buildCorsHeaders(req);
    const integration = await validateWooApiKey(req);
    if (!integration) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Resolve supportPhone and message
    let message = integration.restrictionMessage || "You are restricted from placing orders.";
    let supportPhone = integration.restrictionSupportPhone || integration.supportPhone || "";

    if (!supportPhone && integration.business?.phone) {
        supportPhone = integration.business.phone;
    }

    if (!supportPhone) {
        // Fallback to general settings
        const general = await prisma.appSetting.findUnique({ where: { key: 'general' } });
        const settings = general?.value as any;
        if (settings?.supportPhone) {
            supportPhone = settings.supportPhone;
        } else if (settings?.phone) {
            supportPhone = settings.phone;
        }
    }

    return NextResponse.json({
        incompleteEnabled: integration.incompleteEnabled,
        debounceMs: integration.debounceMs,
        dedupeMinutes: integration.dedupeMinutes,
        retrySeconds: integration.retrySeconds,
        restrictionEnabled: integration.restrictionEnabled,
        restrictionScope: integration.restrictionScope,
        restrictionDurationType: integration.restrictionDurationType,
        restrictionDurationValue: integration.restrictionDurationValue,
        restrictionMessage: message,
        supportPhone: supportPhone || "",
        phoneValidation: {
            country: "BD",
            regex: "^(?:\\+?880|0)[0-9]{10}$",
            length: 11,
            message: "অনুগ্রহ করে সঠিক ফোন নম্বর দিন।"
        }
    }, { headers: corsHeaders });
}
