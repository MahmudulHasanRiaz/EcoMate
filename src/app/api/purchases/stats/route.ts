import { NextRequest } from 'next/server';
import { getPurchaseStats } from '@/server/modules/purchases';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import { getReportCache } from '@/server/utils/report-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('purchases', 'read');
        if (!allowed) return error;

        const { searchParams } = req.nextUrl;
        const from = searchParams.get('from') || undefined;
        const to = searchParams.get('to') || undefined;

        const staffId = (staff as any)?.id || 'anon';
        const key = `report:purchases:stats:${staffId}:${from || 'none'}:${to || 'none'}`;

        const stats = await getReportCache(key, () =>
            getPurchaseStats(from || to ? { from: from!, to: to! } : undefined)
        );

        return apiSuccess(stats);
    } catch (error: any) {
        return apiServerError(error);
    }
}
