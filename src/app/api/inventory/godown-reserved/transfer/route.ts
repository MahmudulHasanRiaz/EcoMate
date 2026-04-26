import { NextRequest } from "next/server";
import { apiServerError, apiSuccess, apiError } from "@/lib/error";
import { enforcePermission } from "@/lib/security";
import { transferGodownReservedStockAggregated } from "@/app/dashboard/inventory/actions";

export async function POST(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission("inventory", "update");
    if (!allowed) return error;

    const body = await req.json();
    const { productId, variantId, quantity, note } = body;

    const result = await transferGodownReservedStockAggregated({
      productId,
      variantId,
      quantity,
      note,
      user: staff?.name,
    });

    if (!result.success) {
      const code = (result as any).code || 'TRANSFER_ERROR';
      const conflictCodes = new Set([
        'INSUFFICIENT_RESERVED_GODOWN',
        'ALLOCATIONS_MISSING',
        'ALLOCATIONS_REBIND_FAILED',
        'LOT_INTEGRITY_ERROR',
      ]);
      const status = conflictCodes.has(code) ? 409 : 400;
      return apiError(result.message, status, { code });
    }

    return apiSuccess(result, result.message);
  } catch (err: any) {
    console.error('[API_GODOWN_RESERVED_TRANSFER]', err);
    return apiServerError(err);
  }
}
