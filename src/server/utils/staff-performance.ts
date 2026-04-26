import prisma from '@/lib/prisma';
import type { OrderStatus } from '@prisma/client';

const statusLabelMap: Record<string, string> = {
  Draft: 'Draft',
  New: 'New',
  Confirmed: 'Confirmed',
  Packing_Hold: 'Packing Hold',
  Canceled: 'Canceled',
  C2C: 'C2C',
  Hold: 'Hold',
  In_Courier: 'In-Courier',
  RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
  Shipped: 'Shipped',
  Delivered: 'Delivered',
  Return_Pending: 'Return Pending',
  Returned: 'Returned',
  Paid_Return: 'Paid Return',
  Partial: 'Partial',
  Incomplete: 'Incomplete',
  Incomplete_Cancelled: 'Incomplete-Cancelled',
  Damaged: 'Damaged',
};

function presentStatus(status: OrderStatus) {
  return statusLabelMap[status] || status;
}

function normalizeCanceledLikeTitle(title?: string | null) {
  return title === 'C2C' ? 'Canceled' : (title || 'Other');
}

type DateRange = {
  start: Date;
  end: Date;
};

export async function getStaffPerformance(staffId: string, range?: DateRange) {
  if (!staffId) {
    return {
      ordersCreated: 0,
      ordersConfirmed: 0,
      ordersWorked: 0,
      totalOrderActions: 0,
      incompleteWorked: 0,
      incompleteConverted: 0,
      incompleteConversionRate: 0,
      statusBreakdown: {},
      createdStatusBreakdown: {},
      confirmedStatusBreakdown: {},
    };
  }

  let ordersCreated = 0;
  let ordersConfirmed = 0;
  let ordersWorked = 0;
  let incompleteWorked = 0;
  let incompleteConverted = 0;
  let incompleteConversionRate = 0;
  let createdStatusGroups: Array<{ status: OrderStatus; _count: { _all: number } }> = [];
  let confirmedStatusGroups: Array<{ status: OrderStatus; _count: { _all: number } }> = [];
  let staffName: string | null = null;

  const staff = await prisma.staffMember.findUnique({
    where: { id: staffId },
    select: { name: true },
  });
  staffName = staff?.name || null;

  if (range) {
    // Use action timestamps for range-based reporting:
    const [createdOrders, allLogs, incompleteAssignedLeads, convertedOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdBy: staffId,
          OR: [{ source: 'manual' }, { source: 'mobile-create' }, { source: null }],
          createdAt: { gte: range.start, lte: range.end },
        },
        select: { id: true },
      }),
      prisma.orderLog.findMany({
        where: {
          timestamp: { gte: range.start, lte: range.end },
          OR: [
            { userId: staffId },
            ...(staffName ? [{ userId: null, user: staffName }] : []),
          ],
        },
        select: { orderId: true, title: true, Order: { select: { source: true } } },
      }),
      prisma.wooCheckoutLead.findMany({
        where: {
          assignedToStaffId: staffId,
          assignedAt: { gte: range.start, lte: range.end },
        },
        select: { id: true },
      }),
      prisma.order.findMany({
        where: {
          source: 'woo-incomplete',
          createdBy: staffId,
          createdAt: { gte: range.start, lte: range.end },
        },
        select: { id: true },
      }),
    ]);

    const convertedOrderIds = convertedOrders.map((o) => o.id);
    const incompleteConvertedLeads = convertedOrderIds.length
      ? await prisma.wooCheckoutLead.findMany({
        where: {
          convertedOrderId: { in: convertedOrderIds },
          convertedAt: { gte: range.start, lte: range.end },
          status: 'CONVERTED',
        },
        select: { id: true },
      })
      : [];

    const createdOrderIds = createdOrders.map((o) => o.id);
    const confirmedLogs = allLogs.filter(
      (l) => l.title === 'Confirmed' && l.Order?.source !== 'woo-incomplete'
    );
    const confirmedOrderIds = Array.from(
      new Set(confirmedLogs.map((l) => l.orderId).filter((id): id is string => Boolean(id)))
    );

    const incompleteWorkedIds = new Set<string>([
      ...incompleteAssignedLeads.map((l) => l.id),
      ...incompleteConvertedLeads.map((l) => l.id),
    ]);
    incompleteWorked = incompleteWorkedIds.size;
    incompleteConverted = incompleteConvertedLeads.length;
    incompleteConversionRate = incompleteWorked > 0 ? (incompleteConverted / incompleteWorked) * 100 : 0;

    ordersCreated = createdOrderIds.length;
    ordersConfirmed = confirmedOrderIds.length;

    // totalOrderActions = total number of valid order actions done by staff in range (from OrderLog)
    const totalOrderActions = allLogs.length + (range ? 0 : 0); // Placeholder if we needed more

    // ordersWorked = distinct orderIds touched by that staff in range
    const workedOrderIds = new Set([
      ...createdOrderIds,
      ...allLogs.map(l => l.orderId).filter((id): id is string => Boolean(id))
    ]);
    ordersWorked = workedOrderIds.size;

    // Status breakdown for "handled actions" should be action-based (log-driven), unique per order
    const statusOrderMap = new Map<string, Set<string>>();
    for (const log of allLogs) {
        if (!log.orderId) continue;
        const label = normalizeCanceledLikeTitle(log.title);
        if (!statusOrderMap.has(label)) {
            statusOrderMap.set(label, new Set());
        }
        statusOrderMap.get(label)!.add(log.orderId);
    }
    
    const statusBreakdown: Record<string, number> = {};
    for (const [label, orderSet] of statusOrderMap.entries()) {
        statusBreakdown[label] = orderSet.size;
    }

    const createdOrdersWithStatus = await prisma.order.findMany({
      where: { id: { in: createdOrderIds } },
      select: { status: true }
    });
    const createdStatusBreakdown: Record<string, number> = {};
    for (const o of createdOrdersWithStatus) {
      const label = presentStatus(o.status);
      createdStatusBreakdown[label] = (createdStatusBreakdown[label] || 0) + 1;
    }

    const confirmedOrdersWithStatus = await prisma.order.findMany({
      where: { id: { in: confirmedOrderIds } },
      select: { status: true }
    });
    const confirmedStatusBreakdown: Record<string, number> = {};
    for (const o of confirmedOrdersWithStatus) {
      const label = presentStatus(o.status);
      confirmedStatusBreakdown[label] = (confirmedStatusBreakdown[label] || 0) + 1;
    }

    return {
      ordersCreated,
      ordersConfirmed,
      ordersWorked,
      totalOrderActions: allLogs.length,
      incompleteWorked,
      incompleteConverted,
      incompleteConversionRate: Number(incompleteConversionRate.toFixed(2)),
      statusBreakdown,
      createdStatusBreakdown,
      confirmedStatusBreakdown,
    };
  } else {
    const [createdCount, confirmedCount, allLogsCount, workedIdsRows, incompleteAssignedLeads, convertedOrders] = await Promise.all([
      prisma.order.count({
        where: {
          createdBy: staffId,
          OR: [{ source: 'manual' }, { source: 'mobile-create' }, { source: null }],
        },
      }),
      prisma.order.count({
        where: {
          confirmedBy: staffId,
          NOT: { source: 'woo-incomplete' },
        },
      }),
      prisma.orderLog.count({
        where: {
          OR: [
            { userId: staffId },
            ...(staffName ? [{ userId: null, user: staffName }] : []),
          ],
        },
      }),
      prisma.orderLog.findMany({
        where: {
          OR: [
            { userId: staffId },
            ...(staffName ? [{ userId: null, user: staffName }] : []),
          ],
        },
        distinct: ['orderId'],
        select: { orderId: true },
      }),
      prisma.wooCheckoutLead.findMany({
        where: {
          assignedToStaffId: staffId,
        },
        select: { id: true },
      }),
      prisma.order.findMany({
        where: {
          source: 'woo-incomplete',
          createdBy: staffId,
        },
        select: { id: true },
      }),
    ]);

    const convertedOrderIds = convertedOrders.map((o) => o.id);
    const incompleteConvertedLeads = convertedOrderIds.length
      ? await prisma.wooCheckoutLead.findMany({
        where: {
          convertedOrderId: { in: convertedOrderIds },
          status: 'CONVERTED',
        },
        select: { id: true },
      })
      : [];

    ordersCreated = createdCount;
    ordersConfirmed = confirmedCount;

    const incompleteWorkedIds = new Set<string>([
      ...incompleteAssignedLeads.map((l) => l.id),
      ...incompleteConvertedLeads.map((l) => l.id),
    ]);
    incompleteWorked = incompleteWorkedIds.size;
    incompleteConverted = incompleteConvertedLeads.length;
    incompleteConversionRate = incompleteWorked > 0 ? (incompleteConverted / incompleteWorked) * 100 : 0;

    const workedOrderIds = new Set(workedIdsRows.map(r => r.orderId).filter(Boolean));
    ordersWorked = workedOrderIds.size;

    // For all-time, we count the unique orders that entered each status (driven by log distinct orderId)
    // The previous logTitlesGrouped was counting total logs. Let's do it right.
    const allLogsRows = await prisma.orderLog.findMany({
        where: {
          OR: [
            { userId: staffId },
            ...(staffName ? [{ userId: null, user: staffName }] : []),
          ],
        },
        select: { orderId: true, title: true }
    });

    const statusOrderMap = new Map<string, Set<string>>();
    for (const log of allLogsRows) {
        if (!log.orderId) continue;
        const label = normalizeCanceledLikeTitle(log.title);
        if (!statusOrderMap.has(label)) {
            statusOrderMap.set(label, new Set());
        }
        statusOrderMap.get(label)!.add(log.orderId);
    }

    const statusBreakdown: Record<string, number> = {};
    for (const [label, orderSet] of statusOrderMap.entries()) {
        statusBreakdown[label] = orderSet.size;
    }

    const createdStatusGroups = await prisma.order.groupBy({
      by: ['status'],
      where: {
        createdBy: staffId,
        OR: [{ source: 'manual' }, { source: 'mobile-create' }, { source: null }],
      },
      _count: { _all: true }
    });
    const createdStatusBreakdown: Record<string, number> = {};
    for (const g of createdStatusGroups) {
      const label = presentStatus(g.status);
      createdStatusBreakdown[label] = (createdStatusBreakdown[label] || 0) + g._count._all;
    }

    const confirmedStatusGroups = await prisma.order.groupBy({
      by: ['status'],
      where: {
        confirmedBy: staffId,
        NOT: { source: 'woo-incomplete' },
      },
      _count: { _all: true }
    });
    const confirmedStatusBreakdown: Record<string, number> = {};
    for (const g of confirmedStatusGroups) {
      const label = presentStatus(g.status);
      confirmedStatusBreakdown[label] = (confirmedStatusBreakdown[label] || 0) + g._count._all;
    }

    return {
      ordersCreated,
      ordersConfirmed,
      ordersWorked,
      totalOrderActions: allLogsCount,
      incompleteWorked,
      incompleteConverted,
      incompleteConversionRate: Number(incompleteConversionRate.toFixed(2)),
      statusBreakdown,
      createdStatusBreakdown,
      confirmedStatusBreakdown,
    };
  }
}
