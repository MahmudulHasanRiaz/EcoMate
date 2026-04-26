import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getCourierMetrics } from '@/server/modules/courier/reconciliation';
import { getReportCache } from '@/server/utils/report-cache';

function parseDateParam(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

const round = (value: number) => Number(value.toFixed(2));

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.courierManagement;
    if (perm && !perm.read) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = req.nextUrl;
    const businessId = url.searchParams.get('businessId') || undefined;
    const courierServiceParam = url.searchParams.get('courierService') || undefined;
    const courierService =
      courierServiceParam && courierServiceParam !== 'all' ? courierServiceParam : undefined;
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];

    const staffId = auth.staff?.id || 'anon';
    const bizScope = businessId || (accessibleBusinessIds.length ? accessibleBusinessIds.join(',') : 'all');
    const key = `report:courier:metrics:${staffId}:${bizScope}:${courierService || 'all'}:${from?.toISOString() || 'none'}:${to?.toISOString() || 'none'}`;

    const { metrics, returnPendingOrders } = await getReportCache(key, async () => {
      const { metrics, returnPendingOrders } = await getCourierMetrics({
        businessId,
        courierService,
        from,
        to,
        accessibleBusinessIds,
      });

      const paymentWhere: any = {};
      if (businessId) {
        paymentWhere.businessId = businessId;
      } else if (accessibleBusinessIds.length) {
        paymentWhere.businessId = { in: accessibleBusinessIds };
      }
      if (courierService) {
        paymentWhere.courierService = courierService;
      }
      paymentWhere.direction = 'Received';
      if (from || to) {
        paymentWhere.paymentDate = {};
        if (from) paymentWhere.paymentDate.gte = from;
        if (to) paymentWhere.paymentDate.lte = to;
      }

      const paymentAgg = await prisma.courierPayment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
      });
      const receivedPayment = Number(paymentAgg._sum.amount || 0);
      metrics.receivedPayment = round(receivedPayment);
      metrics.pendingPayment = round(metrics.expectedPayment - metrics.receivedPayment);

      return { metrics, returnPendingOrders };
    });

    return NextResponse.json({ metrics, returnPendingOrders });
  } catch (error) {
    console.error('[API:COURIER_METRICS]', error);
    return NextResponse.json({ error: 'Failed to load courier metrics' }, { status: 500 });
  }
}
