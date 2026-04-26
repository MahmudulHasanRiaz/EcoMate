import { NextRequest } from "next/server";
import { apiServerError, apiSuccess } from "@/lib/error";
import { getInventoryLotsPaginated } from "@/server/modules/inventory";
import { enforcePermission } from "@/lib/security";

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission("inventory", "read");
    if (!allowed) return error;

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId") || undefined;
    const variantId = searchParams.get("variantId") || undefined;
    const locationId = searchParams.get("locationId") || undefined;
    const cursor = searchParams.get("cursor") || undefined;
    const search = searchParams.get("search") || undefined;
    const pageSize = Number(searchParams.get("pageSize") || "50");

    const data = await getInventoryLotsPaginated({
      productId,
      variantId,
      locationId,
      cursor,
      search,
      pageSize
    });

    return apiSuccess(data);
  } catch (error) {
    console.error("[API:INVENTORY_LOTS]", error);
    return apiServerError(error);
  }
}
