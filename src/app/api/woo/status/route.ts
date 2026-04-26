
import { NextRequest, NextResponse } from "next/server";
import { validateWooApiKey } from "@/server/auth/woo";

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

async function handleStatus(req: NextRequest) {
    const corsHeaders = buildCorsHeaders(req);
    const integration = await validateWooApiKey(req);
    if (!integration) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    return NextResponse.json(
        { status: "connected", integrationId: integration.id, storeName: integration.storeName || null },
        { headers: corsHeaders }
    );
}

export async function GET(req: NextRequest) {
    return handleStatus(req);
}

export async function POST(req: NextRequest) {
    return handleStatus(req);
}
