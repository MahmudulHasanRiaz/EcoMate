import { NextRequest } from 'next/server';
import { getOrderSummaryStats } from '@/server/modules/orders';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import { getReportCache } from '@/server/utils/report-cache';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const businessId = req.nextUrl.searchParams.get('businessId');

    const staffId = (staff as any)?.id || 'anon';
    const key = `report:orders:summary:${staffId}:${from || 'none'}:${to || 'none'}:${businessId || 'all'}`;

    const summary = await getReportCache(key, () => getOrderSummaryStats({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      businessId: businessId || undefined,
    }));

    return apiSuccess(summary);
  } catch (error) {
    console.error('[API:ORDERS_SUMMARY]', error);
    return apiServerError(error);
  }
}

