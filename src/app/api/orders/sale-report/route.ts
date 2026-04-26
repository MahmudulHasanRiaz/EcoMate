import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { StaffRole } from '@prisma/client';
import { normalizeStatusInput } from '@/server/modules/orders';

type SaleStatusBucket = 'Confirmed' | 'Canceled' | 'Hold' | 'Returned' | 'Delivered';

function canonicalizeStatus(status?: string | null): SaleStatusBucket | null {
    if (!status) return null;
    if (status === 'C2C') return 'Canceled';
    if (status === 'Paid_Return' || status === 'Paid Return') return 'Returned';
    if (status === 'Confirmed' || status === 'Canceled' || status === 'Hold' || status === 'Returned' || status === 'Delivered') {
        return status;
    }
    return null;
}

export async function GET(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const role = (staff as any)?.role as StaffRole;
        if (role !== 'Admin' && role !== 'Manager') {
            return apiError('Forbidden. Only Admin and Manager can access this report.', 403);
        }

        const { searchParams } = new URL(req.url);
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const businessId = searchParams.get('businessId');

        const from = fromStr ? new Date(fromStr) : undefined;
        const to = toStr ? new Date(toStr) : undefined;

        const queryBusinessIds = businessId && businessId !== 'all' ? [businessId] : undefined;

        const displayLabels = ['Confirmed', 'Canceled', 'C2C', 'Hold', 'Returned', 'Delivered', 'Cancel', 'RTS (Ready to Ship)', 'RTS', 'Paid_Return', 'Paid Return'];
        const canonicalKeys = ['Confirmed', 'Canceled', 'Hold', 'Returned', 'Delivered'];

        const logs = await prisma.orderLog.findMany({
            where: {
                timestamp: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                },
                title: { in: [...displayLabels, ...canonicalKeys] as string[] },
                Order: {
                    type: { not: 'PARTIAL_RETURN' },
                    ...(queryBusinessIds ? { businessId: { in: queryBusinessIds } } : {})
                },
            },
            select: {
                orderId: true,
                title: true,
                Order: { select: { businessId: true, source: true, Business: { select: { name: true } } } }
            },
        });

        const confirmedOrderIds = Array.from(
            new Set(
                logs
                    .filter((log) => normalizeStatusInput(log.title) === 'Confirmed' && Boolean(log.orderId))
                    .map((log) => log.orderId as string)
            )
        );

        let excludedConfirmedOrderIds = new Set<string>();
        if (confirmedOrderIds.length > 0) {
            const [canceledOrders, deliveredOrReturnedLogs] = await Promise.all([
                prisma.order.findMany({
                    where: {
                        id: { in: confirmedOrderIds },
                        status: { in: ['Canceled', 'C2C'] },
                        type: { not: 'PARTIAL_RETURN' },
                        ...(queryBusinessIds ? { businessId: { in: queryBusinessIds } } : {})
                    },
                    select: { id: true },
                }),
                prisma.orderLog.findMany({
                    where: {
                        orderId: { in: confirmedOrderIds },
                        title: { in: ['Delivered', 'Returned', 'Paid_Return', 'Paid Return'] },
                    },
                    select: { orderId: true },
                }),
            ]);

            const hadDeliveredOrReturned = new Set(
                deliveredOrReturnedLogs.map((l) => l.orderId).filter((id): id is string => Boolean(id))
            );
            excludedConfirmedOrderIds = new Set(
                canceledOrders
                    .map((o) => o.id)
                    .filter((id) => !hadDeliveredOrReturned.has(id))
            );
        }

        const statusTargets: readonly SaleStatusBucket[] = ['Confirmed', 'Canceled', 'Hold', 'Returned', 'Delivered'];
        const incompleteConvertedKey = 'Incomplete Converted' as const;
        const reportColumns = [...statusTargets, incompleteConvertedKey] as const;

        // overall
        const overallCounts: Record<string, number> = {};
        for (const t of reportColumns) overallCounts[t] = 0;

        // By business
        const businessMap = new Map<string, { id: string, name: string, counts: Record<string, number> }>();

        const seen = new Set<string>();
        const seenIncompleteConverted = new Set<string>();

        for (const log of logs) {
            const normalized = normalizeStatusInput(log.title);
            if (!normalized) continue;
            const label = canonicalizeStatus(normalized);
            if (!label) continue;
            if (label === 'Confirmed' && log.orderId && excludedConfirmedOrderIds.has(log.orderId)) continue;

            const dedupeKey = `${label}:${log.orderId}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            overallCounts[label]++;

            const bId = log.Order?.businessId || 'unknown';
            if (!businessMap.has(bId)) {
                const countsForBusiness: Record<string, number> = {};
                for (const t of reportColumns) countsForBusiness[t] = 0;

                businessMap.set(bId, {
                    id: bId,
                    name: log.Order?.Business?.name || 'Unknown Business',
                    counts: countsForBusiness
                });
            }

            businessMap.get(bId)!.counts[label]++;

            // Track converted incomplete leads as a dedicated metric
            // (conversion creates a Confirmed log on orders sourced from woo-incomplete).
            if (label === 'Confirmed' && log.Order?.source === 'woo-incomplete' && log.orderId) {
                if (seenIncompleteConverted.has(log.orderId)) continue;
                seenIncompleteConverted.add(log.orderId);
                overallCounts[incompleteConvertedKey]++;
                businessMap.get(bId)!.counts[incompleteConvertedKey]++;
            }
        }

        const businessData = Array.from(businessMap.values()).sort((a, b) => a.name.localeCompare(b.name));

        // ── Incomplete Conversion Metrics ──
        const incompleteWhere: any = {
            lastSeenAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
            },
            ...(queryBusinessIds ? { businessId: { in: queryBusinessIds } } : {}),
        };

        const incompleteGroupBy = await (prisma as any).wooCheckoutLead.groupBy({
            by: ['status', 'businessId'],
            where: incompleteWhere,
            _count: { _all: true },
        });

        // Resolve business names for incomplete leads
        const incompleteBizIds = Array.from(new Set(incompleteGroupBy.map((g: any) => g.businessId).filter(Boolean)));
        const incompleteBizNames = incompleteBizIds.length > 0
            ? await prisma.business.findMany({ where: { id: { in: incompleteBizIds as string[] } }, select: { id: true, name: true } })
            : [];
        const bizNameMap = new Map(incompleteBizNames.map((b: any) => [b.id, b.name]));

        let totalLeads = 0, converted = 0, notConverted = 0, canceled = 0;
        const incBizMap = new Map<string, { id: string; name: string; totalLeads: number; converted: number; notConverted: number; canceled: number }>();

        for (const g of incompleteGroupBy) {
            const count = g._count._all;
            const bId = g.businessId as string;
            const st = (g.status as string).toUpperCase();

            totalLeads += count;
            if (st === 'CONVERTED') converted += count;
            else if (st === 'OPEN') notConverted += count;
            else if (st === 'CANCELLED') canceled += count;

            if (!incBizMap.has(bId)) {
                incBizMap.set(bId, {
                    id: bId,
                    name: bizNameMap.get(bId) || businessMap.get(bId)?.name || 'Unknown Business',
                    totalLeads: 0, converted: 0, notConverted: 0, canceled: 0,
                });
            }
            const biz = incBizMap.get(bId)!;
            biz.totalLeads += count;
            if (st === 'CONVERTED') biz.converted += count;
            else if (st === 'OPEN') biz.notConverted += count;
            else if (st === 'CANCELLED') biz.canceled += count;
        }

        const conversionRatio = totalLeads > 0 ? Math.round((converted / totalLeads) * 10000) / 100 : 0;
        const incBizData = Array.from(incBizMap.values())
            .map(b => ({ ...b, conversionRatio: b.totalLeads > 0 ? Math.round((b.converted / b.totalLeads) * 10000) / 100 : 0 }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return apiSuccess({
            overall: overallCounts,
            businessData,
            incomplete: {
                overall: { totalLeads, converted, notConverted, canceled, conversionRatio },
                businessData: incBizData,
            },
            metadata: {
                from: fromStr,
                to: toStr,
                businessId,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[API:SALE_REPORT]', error);
        return apiServerError(error);
    }
}
