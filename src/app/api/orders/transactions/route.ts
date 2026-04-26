import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export async function GET(request: Request) {
  try {
    const { allowed, error, staff: user } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'Pending';
    const limit = Number(searchParams.get('limit') || 50);
    const offset = Number(searchParams.get('offset') || 0);

    const where: any = {
      status,
    };

    const transactions = await prisma.orderTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        Order: {
          select: {
            orderNumber: true,
            customerName: true,
            customerPhone: true,
          }
        },
        Account: {
          select: { name: true }
        },
        StaffCreator: {
          select: { name: true }
        },
        StaffApprover: {
          select: { name: true }
        }
      }
    });

    const total = await prisma.orderTransaction.count({ where });

    return NextResponse.json({ data: transactions, total });
  } catch (error: any) {
    console.error('[TRANSACTIONS_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
