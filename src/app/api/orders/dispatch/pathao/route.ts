import { NextRequest } from 'next/server';
import { dispatchPathaoOrders } from '@server/modules/courier/pathao';
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
    const results = await dispatchPathaoOrders(orderIds, actor);
    const successCount = results.filter(r => r.ok).length;
    const failureCount = results.length - successCount;
    return apiSuccess({ results, successCount, failureCount });
  } catch (err: any) {
    console.error('[PATHAO_DISPATCH_API_ERROR]', err);
    return apiServerError(err);
  }
}
