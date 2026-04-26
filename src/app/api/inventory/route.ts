
import { NextRequest } from "next/server";
import { apiError, apiServerError, apiSuccess } from "@/lib/error";
import { getInventoryPaginated } from "@/server/modules/inventory";
import { enforcePermission } from "@/lib/security";

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission("inventory", "read");
        if (!allowed) return error;

        const { searchParams } = new URL(req.url);
        const cursor = searchParams.get("cursor") || undefined;
        const pageSize = Number(searchParams.get("pageSize") || "50");
        const search = searchParams.get("search") || undefined;
        const locationId = searchParams.get("locationId") || undefined;
        const productId = searchParams.get("productId") || undefined;
        const variantId = searchParams.get("variantId") || undefined;
        const statusParam = searchParams.get("status");
        const validStatuses = ['active', 'low-stock', 'low-stock-available', 'out-of-stock', 'all'] as const;
        const status = validStatuses.includes(statusParam as any) ? (statusParam as typeof validStatuses[number]) : 'active';
        const lowStockThreshold = Number(searchParams.get("lowStockThreshold") || "5");

        const data = await getInventoryPaginated({
            cursor,
            pageSize,
            search,
            locationId,
            productId,
            variantId,
            status,
            lowStockThreshold
        });

        return apiSuccess(data);
    } catch (error) {
        console.error("[API:INVENTORY]", error);
        return apiServerError(error);
    }
}
