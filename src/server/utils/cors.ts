import { NextRequest, NextResponse } from "next/server";

export function buildCorsHeaders(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Requested-With",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

export function corsOptionsResponse(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: buildCorsHeaders(req) });
}
