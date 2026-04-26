import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiServerError, apiSuccess } from '@/lib/error';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'create'); // basic pos access req
        if (!allowed || !staff) return error;

        // Fetch showrooms where this staff has access
        const accessibleShowrooms = await prisma.showroom.findMany({
            where: {
                isActive: true,
                Accesses: {
                    some: { staffId: staff.id }
                }
            },
            include: {
                StockLocation: true,
                CashDrawer: {
                    include: { Account: true }
                }
            }
        });

        return apiSuccess({ showrooms: accessibleShowrooms });
    } catch (e: any) {
        console.error('[API:POS_SHOWROOMS]', e);
        return apiServerError(e);
    }
}
