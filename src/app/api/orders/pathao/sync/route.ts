import { NextRequest } from 'next/server';
import { refreshPathaoStatuses } from '@server/modules/courier/pathao';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { allowed, error } = await enforcePermission('orders', 'update');
  if (!allowed) return error;

  const body = await req.json().catch(() => ({}));
  const orderIds = body?.orderIds as string[] | undefined;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return apiError('orderIds is required', 400);
  }

  try {
    const { enqueueCourierSyncJob } = await import('@/server/queues/courier');
    await enqueueCourierSyncJob({ orderIds });
    return apiSuccess({ queued: true }, 'Sync job queued');
  } catch (err: any) {
    console.error('[PATHAO_SYNC_ERROR]', err);
    return apiServerError(err);
  }
}
