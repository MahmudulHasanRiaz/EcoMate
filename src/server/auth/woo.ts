
import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";


export async function validateWooApiKey(req: NextRequest) {
    let token: string | null = null;

    // 1. Check Authorization Header
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    }

    // 2. Check Query Parameter (Compatibility with some plugin versions)
    if (!token) {
        token = req.nextUrl.searchParams.get("apiKey");
    }

    if (!token) return null;

    const integration = await prisma.wooCommerceIntegration.findUnique({
        where: { apiKey: token },
        include: {
            business: true
        }
    });

    return integration;
}

