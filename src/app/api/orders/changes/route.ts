import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiServerError, apiSuccess } from '@/lib/error';

/**
 * Lightweight endpoint to detect order changes.
 * Used for real-time UI refreshing without fetching full order objects.
 */
export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const searchParams = req.nextUrl.searchParams;
        const since = searchParams.get('since');
        const ids = searchParams.get('ids')?.split(',').filter(Boolean);

        if (!since) {
            return NextResponse.json({ changedIds: [], serverTime: new Date().toISOString() });
        }

        const where: any = {
            updatedAt: {
                gt: new Date(since),
            },
        };

        if (ids && ids.length > 0) {
            where.id = { in: ids };
        }

        const changes = await prisma.order.findMany({
            where,
            select: {
                id: true,
                updatedAt: true,
            },
            orderBy: {
                updatedAt: 'desc',
            },
            take: 200, // Safety cap
        });

        return apiSuccess({
            changedIds: changes.map((c) => c.id),
            serverTime: new Date().toISOString(),
        });
    } catch (error: any) {
        return apiServerError(error);
    }
}
