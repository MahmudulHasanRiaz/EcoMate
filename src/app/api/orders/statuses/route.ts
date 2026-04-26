
import { getStatuses } from '@/services/orders';
import { apiSuccess, apiServerError } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const statuses = await getStatuses();
        return apiSuccess(statuses);
    } catch (error: any) {
        console.error('[API:ORDERS_STATUSES_GET]', error);
        return apiServerError(error);
    }
}
