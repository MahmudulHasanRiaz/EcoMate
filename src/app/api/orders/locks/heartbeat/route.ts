import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiError, apiServerError } from '@/lib/error';
import { heartbeatOrderOpenLock } from '@/server/modules/order-open-lock';
import { getActorDetails } from '@/server/utils/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'update');
        if (!allowed) return error;

        const body = await req.json();
        const { orderId, token } = body;

        if (!orderId || !token) {
            return apiError('Missing parameters', 400);
        }

        const actor = await getActorDetails('System');
        const staffId = staff?.id || actor.id || 'unknown';

        const result = await heartbeatOrderOpenLock({ orderId, token, staffId });

        if (result.success && result.active) {
            return apiSuccess({ active: true });
        } else {
            return apiError('Lock expired or invalid', 409, { code: 'LOCK_EXPIRED' });
        }
    } catch (error: any) {
        return apiServerError(error);
    }
}
