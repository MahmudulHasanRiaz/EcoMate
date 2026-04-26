import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { recordOrderPaymentEvent, recomputeOrderFinancialSnapshot } from '@/server/modules/finance';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { allowed, error, staff: user } = await enforcePermission('orders', 'update');
    if (!allowed) return error;

    const { id } = await params;

    const transaction = await prisma.orderTransaction.findUnique({
      where: { id },
      include: { Order: true } // Need to update the Order
    });

    if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (transaction.status !== 'Pending') return NextResponse.json({ error: 'Transaction is not Pending' }, { status: 400 });

    const order = transaction.Order;

    await prisma.$transaction(async (tx) => {
      // 1. Mark as Approved
      await tx.orderTransaction.update({
        where: { id },
        data: {
          status: 'Approved',
          approvedBy: user.id,
          approvedAt: new Date()
        }
      });

      // 2. Update Order amounts
      if (transaction.paymentType === 'Advance') {
        const newPaidAmount = Number(order.paidAmount || 0) + transaction.amount;
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAmount: newPaidAmount,
            paidFromAccountId: transaction.accountId || order.paidFromAccountId
          }
        });
      } else if (transaction.paymentType === 'ShippingPaid') {
        const newShippingPaidAmount = Number(order.shippingPaidAmount || 0) + transaction.amount;
        await tx.order.update({
          where: { id: order.id },
          data: {
            shippingPaid: true,
            shippingPaidAmount: newShippingPaidAmount,
            shippingPaidAccountId: transaction.accountId || order.shippingPaidAccountId
          }
        });
      }

      // 3. Log it
      await tx.orderLog.create({
        data: {
          orderId: order.id,
          title: 'Payment Approved',
          description: `Transaction ${transaction.reference || transaction.id} for Tk ${transaction.amount} was approved.`,
          userId: user.id,
          user: user.name,
        }
      });
    });

    // 4. Resolve the correct account for ledger posting
    //    If accountId is missing from the transaction, resolve by payment method name
    let ledgerAccountId = transaction.accountId;
    if (!ledgerAccountId) {
      const { getAccountIdByName } = await import('@/server/modules/accounting');
      ledgerAccountId = await getAccountIdByName(transaction.paymentMethod) || null;
    }

    // 5. Hit the Ledger
    if (transaction.paymentType === 'Advance') {
      await recordOrderPaymentEvent({
        orderId: order.id,
        eventType: 'AdvanceReceived',
        amount: transaction.amount,
        accountId: ledgerAccountId,
      });
    } else if (transaction.paymentType === 'ShippingPaid') {
      await recordOrderPaymentEvent({
        orderId: order.id,
        eventType: 'ShippingPaid',
        amount: transaction.amount,
        accountId: ledgerAccountId,
      });
    }

    // 6. Recompute financials to sync ledger
    await recomputeOrderFinancialSnapshot(order.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[TRANSACTION_APPROVE_ERROR]', error);
    return NextResponse.json({ error: 'Failed to approve transaction' }, { status: 500 });
  }
}
