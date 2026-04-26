import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const { searchParams } = new URL(req.url);
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const businessId = searchParams.get('businessId');

        const from = fromStr ? new Date(fromStr) : null;
        const to = toStr ? new Date(toStr) : null;

        const mode = from && to ? 'range' : 'all-time';

        const baseWhere: any = {};
        if (businessId) baseWhere.businessId = businessId;

        // Open Now is a pure snapshot based on current status
        const openNow = await prisma.wooCheckoutLead.count({
            where: {
                ...baseWhere,
                status: 'OPEN',
            },
        });

        let totalLeads = 0;
        let converted = 0;
        let notConverted = 0;

        if (mode === 'range' && from && to) {
            totalLeads = await prisma.wooCheckoutLead.count({
                where: {
                    ...baseWhere,
                    firstSeenAt: {
                        gte: from,
                        lte: to,
                    },
                },
            });

            converted = await prisma.wooCheckoutLead.count({
                where: {
                    ...baseWhere,
                    convertedAt: {
                        gte: from,
                        lte: to,
                    },
                    status: 'CONVERTED',
                },
            });
            
            notConverted = await prisma.wooCheckoutLead.count({
                where: {
                    ...baseWhere,
                    firstSeenAt: {
                        gte: from,
                        lte: to,
                    },
                    status: 'CANCELLED',
                },
            });
        } else {
            totalLeads = await prisma.wooCheckoutLead.count({
                where: baseWhere,
            });

            converted = await prisma.wooCheckoutLead.count({
                where: {
                    ...baseWhere,
                    convertedAt: { not: null },
                    status: 'CONVERTED',
                },
            });
            
            notConverted = await prisma.wooCheckoutLead.count({
                where: {
                    ...baseWhere,
                    status: 'CANCELLED',
                },
            });
        }

        const successRatioPct = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;

        return apiSuccess({
            mode,
            openNow,
            totalLeads,
            converted,
            notConverted,
            successRatioPct: Number(successRatioPct.toFixed(2)),
        });
    } catch (error) {
        console.error('[API:INCOMPLETE_SUMMARY]', error);
        return apiServerError(error);
    }
}
