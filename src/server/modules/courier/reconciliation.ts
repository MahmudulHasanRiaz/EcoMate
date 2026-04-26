import prisma from '@/lib/prisma';
import { OrderStatus } from '@prisma/client';
import { computeCourierCharges, type CourierRateConfig } from './charges';

type MetricsParams = {
  businessId?: string;
  courierService?: string;
  from?: Date;
  to?: Date;
  accessibleBusinessIds?: string[];
};

export type CourierMetrics = {
  totalParcels: number;
  totalCodSent: number;
  totalCharges: number;
  expectedPayment: number;
  receivedPayment: number;
  pendingPayment: number;
  returnPendingCount: number;
  returnPendingCod: number;
  returnCharges: number;
};

export type ReturnPendingOrder = {
  id: string;
  orderNumber?: string | null;
  customerName?: string;
  businessId?: string | null;
  businessName?: string | null;
  courierService?: string | null;
  courierStatus?: string | null;
  courierDispatchedAt?: Date | null;
  actualCodAmount?: number | null;
  courierDeliveryCharge?: number | null;
};

type IntegrationKey = string;

const buildIntegrationKey = (businessId?: string | null, courierName?: string | null): IntegrationKey =>
  `${businessId || 'unknown'}:${courierName || 'unknown'}`;

const round = (value: number): number => Number(value.toFixed(2));

export async function getCourierMetrics(params: MetricsParams) {
  const where: any = {
    courierService: params.courierService ? params.courierService : { not: null },
    courierDispatchedAt: { not: null },
  };

  if (params.businessId) {
    where.businessId = params.businessId;
  } else if (params.accessibleBusinessIds?.length) {
    where.businessId = { in: params.accessibleBusinessIds };
  }

  if (params.from || params.to) {
    where.courierDispatchedAt = {};
    if (params.from) where.courierDispatchedAt.gte = params.from;
    if (params.to) where.courierDispatchedAt.lte = params.to;
  }

  // 1. Success Metrics (Delivered/In-Transit) - Not Returned/Pending
  // Note: Original logic excluded ReturnPending from parcels/COD/charges.
  // And excluded Returned from COD.
  // But Returned DOES incur charges (delivery only, no COD charge).

  const [notReturnStats, returnedStats, returnPendingStats, returnPendingList] = await Promise.all([
    // Active/Delivered stats
    prisma.order.aggregate({
      where: {
        ...where,
        status: { notIn: [OrderStatus.Return_Pending, OrderStatus.Returned, 'Paid_Return' as any] }
      },
      _count: { _all: true },
      _sum: {
        actualCodAmount: true,
        courierDeliveryCharge: true,
        courierCodCharge: true
      }
    }),
    // Returned stats (Charges only)
    prisma.order.aggregate({
      where: {
        ...where,
        status: { in: [OrderStatus.Returned, 'Paid_Return' as any] }
      },
      _sum: {
        courierDeliveryCharge: true
      }
    }),
    // Return Pending stats
    prisma.order.aggregate({
      where: {
        ...where,
        status: OrderStatus.Return_Pending
      },
      _count: { _all: true },
      _sum: {
        actualCodAmount: true
      }
    }),
    // Fetch a subset of return pending for initial view (limit 50)
    prisma.order.findMany({
      where: {
        ...where,
        status: OrderStatus.Return_Pending
      },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        businessId: true,
        Business: { select: { name: true } },
        courierService: true,
        courierStatus: true,
        courierDispatchedAt: true,
        actualCodAmount: true,
        courierDeliveryCharge: true,
      }
    })
  ]);

  const metrics: CourierMetrics = {
    totalParcels: notReturnStats._count._all || 0,
    totalCodSent: round(notReturnStats._sum.actualCodAmount || 0),
    // Charges: (Active Delivery + Active COD Charge)
    totalCharges: round((notReturnStats._sum.courierDeliveryCharge || 0) + (notReturnStats._sum.courierCodCharge || 0)),

    // Returned Stats
    returnCharges: round(returnedStats._sum.courierDeliveryCharge || 0),

    // Return Pending Stats
    returnPendingCount: returnPendingStats._count._all || 0,
    returnPendingCod: round(returnPendingStats._sum.actualCodAmount || 0),

    // Computed
    expectedPayment: 0,
    receivedPayment: 0,
    pendingPayment: 0,
  };

  metrics.expectedPayment = round(metrics.totalCodSent - metrics.totalCharges);

  const returnPendingOrders: ReturnPendingOrder[] = returnPendingList.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    businessId: o.businessId,
    businessName: o.Business?.name || null,
    courierService: o.courierService || null,
    courierStatus: o.courierStatus || null,
    courierDispatchedAt: o.courierDispatchedAt,
    actualCodAmount: o.actualCodAmount || 0,
    courierDeliveryCharge: o.courierDeliveryCharge || 0,
  }));

  return { metrics, returnPendingOrders };
}

export async function getReturnPendingOrdersPaginated(params: MetricsParams & { pageSize?: number; cursor?: string; includeTotal?: boolean }) {
  const { pageSize = 50, cursor, includeTotal, ...filters } = params;
  const where: any = {
    courierService: filters.courierService ? filters.courierService : { not: null },
    courierDispatchedAt: { not: null },
    status: OrderStatus.Return_Pending
  };

  if (filters.businessId) {
    where.businessId = filters.businessId;
  } else if (filters.accessibleBusinessIds?.length) {
    where.businessId = { in: filters.accessibleBusinessIds };
  }

  if (filters.from || filters.to) {
    where.courierDispatchedAt = {};
    if (filters.from) where.courierDispatchedAt.gte = filters.from;
    if (filters.to) where.courierDispatchedAt.lte = filters.to;
  }

  const limit = Math.min(pageSize, 100);

  const [total, items] = await Promise.all([
    includeTotal ? prisma.order.count({ where }) : Promise.resolve(0),
    prisma.order.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ courierDispatchedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        businessId: true,
        Business: { select: { name: true } },
        courierService: true,
        courierStatus: true,
        courierDispatchedAt: true,
        actualCodAmount: true,
        courierDeliveryCharge: true,
      }
    })
  ]);

  const hasMore = items.length > limit;
  const resultItems = hasMore ? items.slice(0, limit) : items;
  let nextCursor: string | null = null;
  if (hasMore) {
    nextCursor = resultItems[resultItems.length - 1].id;
  }

  const mapped = resultItems.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    businessId: o.businessId,
    businessName: o.Business?.name || null,
    courierService: o.courierService || null,
    courierStatus: o.courierStatus || null,
    courierDispatchedAt: o.courierDispatchedAt,
    actualCodAmount: o.actualCodAmount || 0,
    courierDeliveryCharge: o.courierDeliveryCharge || 0,
  }));

  return {
    items: mapped,
    total,
    pageSize: limit,
    nextCursor,
    hasMore
  };
}
