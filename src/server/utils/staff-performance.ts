import prisma from '@/lib/prisma';
import type { OrderStatus } from '@prisma/client';

const statusLabelMap: Record<string, string> = {
  Draft: 'Draft',
  New: 'New',
  Confirmed: 'Confirmed',
  Confirmed_Waiting: 'Confirmed Waiting',
  Packing_Hold: 'Packing Hold',
  Canceled: 'Canceled',
  C2C: 'Canceled',
  Hold: 'Hold',
  In_Courier: 'In-Courier',
  RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
  Shipped: 'Shipped',
  Delivered: 'Delivered',
  Return_Pending: 'Return Pending',
  Returned: 'Returned',
  Paid_Return: 'Paid Return',
  Partial: 'Partial',
  No_Response: 'No Response',
  Incomplete: 'Incomplete',
  Incomplete_Cancelled: 'Incomplete-Cancelled',
  Damaged: 'Damaged',
};

function presentStatus(status: OrderStatus) {
  return statusLabelMap[status] || status;
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

    const totalOrderActions = allLogs.length;

    const workedOrderIds = new Set([
      ...createdOrderIds,
      ...allLogs.map(l => l.orderId).filter((id): id is string => Boolean(id))
    ]);
    ordersWorked = workedOrderIds.size;

    const workedOrderIdsArr = Array.from(workedOrderIds);
    const workedOrderStatuses = workedOrderIdsArr.length
      ? await prisma.order.findMany({
          where: { id: { in: workedOrderIdsArr } },
          select: { status: true }
        })
      : [];
    const statusBreakdown: Record<string, number> = {};
    for (const o of workedOrderStatuses) {
      const label = presentStatus(o.status);
      statusBreakdown[label] = (statusBreakdown[label] || 0) + 1;
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

    const workedOrderIdsArr = Array.from(workedOrderIds);
    const workedOrderStatuses = workedOrderIdsArr.length
      ? await prisma.order.findMany({
          where: { id: { in: workedOrderIdsArr } },
          select: { status: true }
        })
      : [];
    const statusBreakdown: Record<string, number> = {};
    for (const o of workedOrderStatuses) {
      const label = presentStatus(o.status);
      statusBreakdown[label] = (statusBreakdown[label] || 0) + 1;
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

type StaffListPerfValue = {
  ordersCreated: number;
  ordersConfirmed: number;
  ordersWorked: number;
  totalOrderActions: number;
  statusBreakdown: Record<string, number>;
};

export async function batchGetStaffListPerformance(
  staffIds: string[],
  range?: DateRange,
): Promise<Map<string, StaffListPerfValue>> {
  const perfMap = new Map<string, StaffListPerfValue>();
  if (!staffIds.length) return perfMap;

  for (const id of staffIds) {
    perfMap.set(id, { ordersCreated: 0, ordersConfirmed: 0, ordersWorked: 0, totalOrderActions: 0, statusBreakdown: {} });
  }

  const rangeFilter = range
    ? { createdAt: { gte: range.start, lte: range.end } }
    : {};
  const logRangeFilter = range
    ? { timestamp: { gte: range.start, lte: range.end } }
    : {};
  const sourceFilter = [{ source: 'manual' }, { source: 'mobile-create' }, { source: null }];

  const [createdGroups, createdOrderRows] = await Promise.all([
    prisma.order.groupBy({
      by: ['createdBy'],
      where: { createdBy: { in: staffIds }, OR: sourceFilter, ...rangeFilter },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { createdBy: { in: staffIds }, OR: sourceFilter, ...rangeFilter },
      select: { id: true, createdBy: true },
    }),
  ]);

  for (const g of createdGroups) {
    if (g.createdBy && perfMap.has(g.createdBy)) {
      perfMap.get(g.createdBy)!.ordersCreated = g._count._all;
    }
  }

  const createdByStaff = new Map<string, Set<string>>();
  for (const row of createdOrderRows) {
    if (!row.createdBy) continue;
    if (!createdByStaff.has(row.createdBy)) createdByStaff.set(row.createdBy, new Set());
    createdByStaff.get(row.createdBy)!.add(row.id);
  }

  const confirmedGroups = await prisma.order.groupBy({
    by: ['confirmedBy'],
    where: { confirmedBy: { in: staffIds }, NOT: { source: 'woo-incomplete' }, ...rangeFilter },
    _count: { _all: true },
  });
  for (const g of confirmedGroups) {
    if (g.confirmedBy && perfMap.has(g.confirmedBy)) {
      perfMap.get(g.confirmedBy)!.ordersConfirmed = g._count._all;
    }
  }

  const allLogs = await prisma.orderLog.findMany({
    where: { userId: { in: staffIds }, ...logRangeFilter },
    select: { userId: true, orderId: true },
  });

  const logCountPerStaff = new Map<string, number>();
  const logOrderIdsPerStaff = new Map<string, Set<string>>();
  for (const log of allLogs) {
    if (!log.userId || !log.orderId) continue;
    logCountPerStaff.set(log.userId, (logCountPerStaff.get(log.userId) || 0) + 1);
    if (!logOrderIdsPerStaff.has(log.userId)) logOrderIdsPerStaff.set(log.userId, new Set());
    logOrderIdsPerStaff.get(log.userId)!.add(log.orderId);
  }

  const allWorkedIds = new Set<string>();
  const workedPerStaff = new Map<string, Set<string>>();
  for (const [staffId, ids] of createdByStaff) {
    workedPerStaff.set(staffId, new Set(ids));
    for (const id of ids) allWorkedIds.add(id);
  }
  for (const [staffId, ids] of logOrderIdsPerStaff) {
    if (!workedPerStaff.has(staffId)) workedPerStaff.set(staffId, new Set());
    for (const id of ids) {
      workedPerStaff.get(staffId)!.add(id);
      allWorkedIds.add(id);
    }
  }

  const orderStatusMap = allWorkedIds.size
    ? new Map(
        (await prisma.order.findMany({
          where: { id: { in: Array.from(allWorkedIds) } },
          select: { id: true, status: true },
        })).map(o => [o.id, o.status])
      )
    : new Map<string, OrderStatus>();

  for (const [staffId, orderIds] of workedPerStaff) {
    const perf = perfMap.get(staffId);
    if (!perf) continue;

    perf.ordersWorked = orderIds.size;
    perf.totalOrderActions = logCountPerStaff.get(staffId) || 0;

    const breakdown: Record<string, number> = {};
    for (const orderId of orderIds) {
      const status = orderStatusMap.get(orderId);
      if (status) {
        const label = presentStatus(status);
        breakdown[label] = (breakdown[label] || 0) + 1;
      }
    }
    perf.statusBreakdown = breakdown;
  }

  return perfMap;
}
