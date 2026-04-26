import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'read');
    if (!allowed || !staff) return error;

    const { searchParams } = new URL(req.url);
    const showroomId = searchParams.get('showroomId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const staffId = searchParams.get('staffId');

    if (!showroomId) return apiError('showroomId is required', 422);

    // Verify showroom access
    const access = await prisma.showroomAccess.findUnique({
      where: { showroomId_staffId: { showroomId, staffId: staff.id } },
    });
    if (!access && staff.role !== 'Admin') {
      return apiError('No access to this showroom', 403);
    }

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const orderWhere: any = {
      platform: 'POS',
      showroomId,
      isDeleted: false,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      ...(staffId ? { createdBy: staffId } : {}),
    };

    // Get order count and totals
    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        total: true,
        paidAmount: true,
        paymentMethod: true,
        status: true,
        createdBy: true,
      },
    });

    // Get payment events for these orders
    const orderIds = orders.map((o) => o.id);

    const paymentEvents = orderIds.length > 0
      ? await prisma.orderPaymentEvent.findMany({
          where: {
            orderId: { in: orderIds },
            eventType: { in: ['AdvanceReceived', 'Refund'] },
          },
          select: { orderId: true, eventType: true, amount: true, accountId: true },
        })
      : [];

    // Aggregate
    let totalReceived = 0;
    let totalRefunded = 0;
    for (const evt of paymentEvents) {
      if (evt.eventType === 'AdvanceReceived') totalReceived += evt.amount;
      if (evt.eventType === 'Refund') totalRefunded += evt.amount;
    }

    // Breakdown by payment method
    const methodMap = new Map<string, number>();
    for (const order of orders) {
      const method = order.paymentMethod || 'Unknown';
      methodMap.set(method, (methodMap.get(method) || 0) + (order.paidAmount || 0));
    }

    const breakdown = Array.from(methodMap.entries()).map(([method, amount]) => ({
      paymentMethod: method,
      amount,
    }));

    // Status breakdown
    const statusMap = new Map<string, number>();
    for (const order of orders) {
      const s = order.status || 'Unknown';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    return apiSuccess({
      orderCount: orders.length,
      totalCollected: totalReceived,
      totalRefunded,
      netCollected: totalReceived - totalRefunded,
      totalOrderValue: orders.reduce((sum, o) => sum + (o.total || 0), 0),
      breakdown,
      statusBreakdown,
    });
  } catch (e: any) {
    console.error('[API:POS_REPORTS_SALES]', e);
    return apiServerError(e);
  }
}
