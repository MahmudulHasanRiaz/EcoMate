import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'create');
        if (!allowed || !staff) return error;

        const url = new URL(req.url);
        const showroomId = url.searchParams.get('showroomId');
        if (!showroomId) return apiError('showroomId is required', 422, { code: 'SHOWROOM_REQUIRED' });

        const showroom = await prisma.showroom.findUnique({
            where: { id: showroomId },
            include: { CashDrawer: { include: { Account: true } } }
        });

        if (!showroom) return apiError('Showroom not found', 404, { code: 'SHOWROOM_NOT_FOUND' });

        // Verify staff has access
        const access = await prisma.showroomAccess.findUnique({
            where: { showroomId_staffId: { showroomId, staffId: staff.id } }
        });
        if (!access) {
            return apiError('Forbidden', 403, { code: 'FORBIDDEN_SHOWROOM_ACCESS' });
        }

        // Find active session
        const activeSession = await prisma.cashDrawerSession.findFirst({
            where: { cashDrawerId: showroom.cashDrawerId, status: 'Open' },
            orderBy: { openedAt: 'desc' },
            include: { OpenedBy: { select: { clerkId: true } } }
        });

        // Compute drawer balance strictly from Ledger
        const agg = await prisma.ledgerEntry.aggregate({
            where: { accountId: showroom.CashDrawer.accountId },
            _sum: { debit: true, credit: true }
        });
        const isDebitNormal = showroom.CashDrawer.Account.type === 'Asset' || showroom.CashDrawer.Account.type === 'Expense';
        const d = Number(agg._sum.debit || 0);
        const c = Number(agg._sum.credit || 0);
        const computedBalance = isDebitNormal ? (d - c) : (c - d);

        return apiSuccess({
            session: activeSession,
            computedBalance,
            drawerName: showroom.CashDrawer.name,
            cashDrawerId: showroom.cashDrawerId
        });
    } catch (e: any) {
        console.error('[API:POS_DRAWER_SESSION_GET]', e);
        return apiServerError(e);
    }
}
