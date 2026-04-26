import { NextRequest } from 'next/server';
import { getCustomerStats } from '@server/modules/customers';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import { getReportCache } from '@/server/utils/report-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('customers', 'read');
        if (!allowed) return error;

        const url = req.nextUrl;
        const dateFrom = url.searchParams.get('dateFrom') || undefined;
        const dateTo = url.searchParams.get('dateTo') || undefined;

        const staffId = (staff as any)?.id || 'anon';
        const key = `report:customers:stats:${staffId}:${dateFrom || 'none'}:${dateTo || 'none'}`;

        const stats = await getReportCache(key, () => getCustomerStats({ dateFrom, dateTo }));
        return apiSuccess(stats);
    } catch (error: any) {
        return apiServerError(error);
    }
}
