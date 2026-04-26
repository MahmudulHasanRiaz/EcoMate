import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export async function POST(req: NextRequest) {
    try {
        const { allowed, error, staff } = await enforcePermission('orders', 'create');
        if (!allowed || !staff) return error;

        const body = await req.json();
        const { showroomId, countedCash, note } = body;
        
        if (!showroomId) return apiError('showroomId is required', 422, { code: 'SHOWROOM_REQUIRED' });
        const counted = Number(countedCash);
        if (!Number.isFinite(counted) || counted < 0) {
            return apiError('Invalid countedCash amount', 422, { code: 'INVALID_COUNTED_CASH' });
        }
        
        // Find showroom
        const showroom = await prisma.showroom.findUnique({
            where: { id: showroomId },
            include: { CashDrawer: { include: { Account: true } } }
        });
        if (!showroom) return apiError('Showroom not found', 404, { code: 'SHOWROOM_NOT_FOUND' });

        // Enforce Access
        const access = await prisma.showroomAccess.findUnique({
             where: { showroomId_staffId: { showroomId, staffId: staff.id } }
        });
        if (!access) return apiError('Forbidden', 403, { code: 'FORBIDDEN_SHOWROOM_ACCESS' });

        // Find active session
        const activeSession = await prisma.cashDrawerSession.findFirst({
            where: { cashDrawerId: showroom.cashDrawerId, status: 'Open' }
        });
        if (!activeSession) {
            return apiError('No open session found for this drawer', 409, { code: 'NO_OPEN_SESSION' });
        }

        // Validate computed balances vs countedCash
        const agg = await prisma.ledgerEntry.aggregate({
            where: { accountId: showroom.CashDrawer.accountId },
            _sum: { debit: true, credit: true }
        });
        const isDebitNormal = showroom.CashDrawer.Account.type === 'Asset' || showroom.CashDrawer.Account.type === 'Expense';
        const d = Number(agg._sum.debit || 0);
        const c = Number(agg._sum.credit || 0);
        const computedBalance = isDebitNormal ? (d - c) : (c - d);

        if (Math.abs(computedBalance - counted) > 0.01) {
            return apiError('Drawer balance mismatch', 409, { code: 'DRAWER_BALANCE_MISMATCH', expected: computedBalance, counted });
        }

        // Close shift
        const session = await prisma.cashDrawerSession.update({
            where: { id: activeSession.id },
            data: {
                closedById: staff.id,
                closingBalance: computedBalance,
                status: 'Closed',
                closedAt: new Date(),
                notes: note ? `${activeSession.notes ? activeSession.notes + '\n' : ''}${note}` : activeSession.notes
            }
        });

        return apiSuccess({ session });
    } catch (e: any) {
        console.error('[API:POS_DRAWER_SESSION_CLOSE]', e);
        return apiServerError(e);
    }
}
