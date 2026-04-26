
import { NextRequest } from 'next/server';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickNumber(source: Record<string, any> | null | undefined, keys: string[]): number {
    if (!source) return 0;
    for (const key of keys) {
        const raw = source[key];
        const num = Number(raw ?? 0);
        if (Number.isFinite(num) && num > 0) return num;
    }
    return 0;
}

function aggregateFromSummaries(
    summaries: Record<string, Record<string, any>> | null | undefined
): { total: number; success: number; failed: number } {
    if (!summaries) return { total: 0, success: 0, failed: 0 };

    return Object.values(summaries).reduce<{ total: number; success: number; failed: number }>(
        (acc, row) => {
            acc.total += pickNumber(row, ['Total Parcels', 'Total Delivery']);
            acc.success += pickNumber(row, ['Delivered Parcels', 'Successful Delivery']);
            acc.failed += pickNumber(row, ['Canceled Parcels', 'Canceled Delivery']);
            return acc;
        },
        { total: 0, success: 0, failed: 0 }
    );
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const body = await req.json().catch(() => ({}));
        const { phones } = body;

        if (!Array.isArray(phones) || phones.length === 0) {
            return apiError('phones must be a non-empty array', 400);
        }

        const { fetchCourierReport } = await import('@/server/utils/courier');

        const summaryMap: Record<string, { total: number; success: number; failed: number; successPct: number; failedPct: number; }> = {};

        // concurrency limit implementation
        const CONCURRENCY_LIMIT = 5;
        for (let i = 0; i < phones.length; i += CONCURRENCY_LIMIT) {
            const chunk = phones.slice(i, i + CONCURRENCY_LIMIT);
            const chunkPromises = chunk.map(async (phone) => {
                const report = await fetchCourierReport(phone);
                if (report && report.totalSummary) {
                    const totalFromTop = pickNumber(report.totalSummary as any, ['Total Parcels', 'Total Delivery']);
                    const successFromTop = pickNumber(report.totalSummary as any, ['Delivered Parcels', 'Successful Delivery']);
                    const failedFromTop = pickNumber(report.totalSummary as any, ['Canceled Parcels', 'Canceled Delivery']);

                    const fromSummaries = aggregateFromSummaries((report as any).Summaries);
                    const total = totalFromTop > 0 ? totalFromTop : fromSummaries.total;
                    const success = successFromTop > 0 ? successFromTop : fromSummaries.success;
                    const failed = failedFromTop > 0 ? failedFromTop : fromSummaries.failed;

                    summaryMap[phone] = {
                        total,
                        success,
                        failed,
                        successPct: total > 0 ? Math.round((success / total) * 100) : 0,
                        failedPct: total > 0 ? Math.round((failed / total) * 100) : 0
                    };
                } else {
                    summaryMap[phone] = { total: 0, success: 0, failed: 0, successPct: 0, failedPct: 0 };
                }
            });
            await Promise.all(chunkPromises);
        }

        return apiSuccess(summaryMap);
    } catch (e: any) {
        console.error('[API:ORDERS_COURIER_SUMMARY]', e);
        return apiServerError(e);
    }
}
