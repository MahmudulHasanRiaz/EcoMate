import { NextRequest } from 'next/server';
import { apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { getInventoryMovementsPaginated } from '@/server/modules/inventory';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('inventory', 'read');
    if (!allowed) return error;

    const params = req.nextUrl.searchParams;
    const pageSize = Number(params.get('pageSize') || '50');
    const cursor = params.get('cursor') || undefined;
    const inventoryItemIds = params.get('inventoryItemIds')?.split(',').map(s => s.trim()).filter(Boolean);
    const productId = params.get('productId') || undefined;
    const variantId = params.get('variantId') || undefined;
    const locationId = params.get('locationId') || undefined;

    const data = await getInventoryMovementsPaginated({
      inventoryItemIds,
      productId,
      variantId,
      locationId,
      cursor,
      pageSize
    });

    return apiSuccess(data);
  } catch (error) {
    console.error('[API:INVENTORY_MOVEMENTS]', error);
    return apiServerError(error);
  }
}
