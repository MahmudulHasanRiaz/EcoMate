import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { updateOrderDetails } from '@/server/modules/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'update');
    if (!allowed || !staff) return error;

    const body = await req.json();
    const orderId = String(body?.orderId || '').trim();
    const showroomId = String(body?.showroomId || '').trim();
    const refundAmount = Number(body?.refundAmount || 0);

    if (!orderId) return apiError('orderId is required', 422, { code: 'ORDER_ID_REQUIRED' });
    if (!showroomId) return apiError('showroomId is required', 422, { code: 'SHOWROOM_REQUIRED' });
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return apiError('refundAmount must be > 0', 422, { code: 'INVALID_REFUND_AMOUNT' });
    }

    const access = await prisma.showroomAccess.findUnique({
      where: { showroomId_staffId: { showroomId, staffId: staff.id } },
      select: { id: true },
    });
    if (!access && staff.role !== 'Admin') {
      return apiError('No access to this showroom', 403, { code: 'FORBIDDEN_SHOWROOM_ACCESS' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, showroomId: true, platform: true, paidAmount: true },
    });
    if (!order) return apiError('Order not found', 404, { code: 'ORDER_NOT_FOUND' });
    if (order.platform !== 'POS') return apiError('Only POS orders are supported for POS refunds', 422, { code: 'NOT_POS_ORDER' });
    if (order.showroomId !== showroomId) return apiError('Order does not belong to this showroom', 422, { code: 'SHOWROOM_MISMATCH' });

    const showroom = await prisma.showroom.findUnique({
      where: { id: showroomId },
      include: { CashDrawer: { select: { accountId: true } } },
    });
    if (!showroom) return apiError('Showroom not found', 404, { code: 'SHOWROOM_NOT_FOUND' });
    if (!showroom.isActive) return apiError('Showroom is not active', 409, { code: 'SHOWROOM_INACTIVE' });

    const activeSession = await prisma.cashDrawerSession.findFirst({
      where: { cashDrawerId: showroom.cashDrawerId, status: 'Open' },
      select: { id: true },
    });
    if (!activeSession) return apiError('Shift is not open for this showroom', 409, { code: 'SHIFT_NOT_OPEN' });

    const paidAmount = Number(order.paidAmount || 0);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return apiError('This order has no paid amount to refund', 422, { code: 'NOTHING_TO_REFUND' });
    }
    if (refundAmount > paidAmount) {
      return apiError('Refund amount cannot be greater than paid amount', 422, {
        code: 'REFUND_EXCEEDS_PAID_AMOUNT',
        paidAmount,
        refundAmount,
      });
    }

    const paidAmountAfter = Number((paidAmount - refundAmount).toFixed(2));
    await updateOrderDetails(
      order.id,
      {
        paidAmount: paidAmountAfter,
        refundAccountId: showroom.CashDrawer.accountId,
      },
      staff.name
    );

    return apiSuccess(
      { orderId: order.id, refundAmount, paidAmountBefore: paidAmount, paidAmountAfter },
      'Refund processed successfully'
    );
  } catch (e: any) {
    console.error('[API:POS_RETURNS]', e);
    return apiServerError(e);
  }
}

