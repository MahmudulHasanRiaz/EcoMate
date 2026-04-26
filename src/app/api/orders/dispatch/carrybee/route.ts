import { NextRequest } from 'next/server';
import { dispatchCarrybeeOrders } from '@server/modules/courier/carrybee';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { allowed, error, staff } = await enforcePermission('orders', 'update');
  if (!allowed) return error;

  const body = await req.json().catch(() => ({}));
  const orderIds = body?.orderIds as string[] | undefined;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return apiError('orderIds is required', 400);
  }

  try {
    const actor = staff?.name || 'System';
    const results = await dispatchCarrybeeOrders(orderIds, actor);
    const successCount = results.filter(r => r.ok).length;
    const failureCount = results.length - successCount;
    const failedItems = results.filter(r => !r.ok).map(r => ({ orderId: r.id, message: r.message }));
    const statusCodeHint = failureCount > 0 && successCount === 0 ? 422 : 200;
    return apiSuccess({ results, successCount, failureCount, failedItems, statusCodeHint });
  } catch (err: any) {
    console.error('[CARRYBEE_DISPATCH_API_ERROR]', err);
    return apiServerError(err);
  }
}
