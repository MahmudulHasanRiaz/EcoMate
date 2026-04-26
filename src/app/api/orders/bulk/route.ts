import { NextRequest } from 'next/server';
import { bulkUpdateStatus } from '@server/modules/orders';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess } from '@/lib/error';

export async function POST(req: NextRequest) {
  const { allowed, error, staff } = await enforcePermission('orders', 'update');
  if (!allowed) return error;

  const body = await req.json().catch(() => ({}));
  const ids = body.ids as string[] | undefined;
  const action = body.action as string | undefined;
  const validActions = new Set(['confirm', 'rts', 'ship', 'deliver', 'cancel', 'return']);

  if (!Array.isArray(ids) || ids.length === 0) {
    return apiError('ids required', 400);
  }
  if (!action || !validActions.has(action)) {
    return apiError('Invalid action', 400);
  }

  const actor = staff?.name || 'System';
  const results = await bulkUpdateStatus(ids, action as any, actor);
  return apiSuccess(results);
}
