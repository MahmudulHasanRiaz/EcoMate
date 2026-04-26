import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { allowed, error, staff: user } = await enforcePermission('orders', 'update');
    if (!allowed) return error;

    const { id } = await params;

    const transaction = await prisma.orderTransaction.findUnique({
      where: { id },
      include: { Order: true }
    });

    if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (transaction.status !== 'Pending') return NextResponse.json({ error: 'Transaction is not Pending' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      // Mark as Rejected
      await tx.orderTransaction.update({
        where: { id },
        data: {
          status: 'Rejected',
          rejectedBy: user.id,
          rejectedAt: new Date()
        }
      });

      // Log it
      await tx.orderLog.create({
        data: {
          orderId: transaction.orderId,
          title: 'Payment Rejected',
          description: `Transaction ${transaction.reference || transaction.id} for Tk ${transaction.amount} was rejected.`,
          userId: user.id,
          user: user.name,
        }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[TRANSACTION_REJECT_ERROR]', error);
    return NextResponse.json({ error: 'Failed to reject transaction' }, { status: 500 });
  }
}
