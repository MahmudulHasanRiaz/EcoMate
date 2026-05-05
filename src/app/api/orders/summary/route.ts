import { NextRequest } from 'next/server';
import { getOrderSummaryStats } from '@/server/modules/orders';
import { enforcePermission } from '@/lib/security';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { getReportCache } from '@/server/utils/report-cache';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const businessId = req.nextUrl.searchParams.get('businessId');
    const channel = req.nextUrl.searchParams.get('channel') || undefined;

    // Validation
    const validChannels = ['Retail', 'Wholesale', 'all'];
    if (channel && !validChannels.includes(channel)) {
      return apiError(`Invalid channel: ${channel}. Must be one of ${validChannels.join(', ')}`, 400);
    }

    // Authorization Guard for Wholesale
    const canAccessWholesale = ['SuperAdmin', 'Admin', 'Manager'].includes(staff?.role || '');
    const requestedWholesale = channel === 'Wholesale' || channel === 'all';
    if (requestedWholesale && !canAccessWholesale) {
      return apiError('Access denied: Wholesale data requires elevated permissions.', 403);
    }

    const staffId = (staff as any)?.id || 'anon';
    const key = `report:orders:summary:${staffId}:${from || 'none'}:${to || 'none'}:${businessId || 'all'}:${channel || 'Retail'}`;

    const summary = await getReportCache(key, () => getOrderSummaryStats({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      businessId: businessId || undefined,
      channel: channel as any,
    }));

    return apiSuccess(summary);
  } catch (error) {
    console.error('[API:ORDERS_SUMMARY]', error);
    return apiServerError(error);
  }
}

