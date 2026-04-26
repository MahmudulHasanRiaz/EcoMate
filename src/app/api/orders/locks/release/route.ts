
import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiError, apiServerError } from '@/lib/error';
import { releaseOrderOpenLock } from '@/server/modules/order-open-lock';
import { getActorDetails } from '@/server/utils/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'update');
        if (!allowed) return error;

        const body = await req.json();
        const { orderId, token } = body;

        // Silent success if params missing, just logging
        if (!orderId || !token) {
            return apiSuccess({ released: true });
        }

        const actor = await getActorDetails('System');
        const staffId = staff?.id || actor.id || 'unknown';

        await releaseOrderOpenLock({ orderId, token, staffId });

        return apiSuccess({ released: true });
    } catch (error: any) {
        return apiServerError(error);
    }
}
