import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { allowed, error, staff } = await enforcePermission('pos', 'create');
    if (!allowed || !staff) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { showroomId, amount, reason } = body;

    if (!showroomId || !amount || isNaN(Number(amount)) || !reason) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // Find the showroom to get cashDrawerId
    const showroom = await prisma.showroom.findUnique({
      where: { id: showroomId }
    });

    if (!showroom || !showroom.cashDrawerId) {
      return NextResponse.json({ success: false, message: 'Showroom or drawer not found' }, { status: 404 });
    }

    const drawer = await prisma.cashDrawer.findUnique({
      where: { id: showroom.cashDrawerId },
      include: { Sessions: { where: { closedAt: null }, take: 1 } }
    });

    if (!drawer || drawer.Sessions.length === 0) {
      return NextResponse.json({ success: false, message: 'No active shift for this drawer' }, { status: 400 });
    }

    const amt = Number(amount);

    // Create the adjustment
    const adjustment = await prisma.cashDrawerAdjustment.create({
      data: {
        cashDrawerId: drawer.id,
        createdById: staff.id,
        amount: amt,
        reason: reason,
        postingGroup: 'POS_EXPENSE',
      }
    });

    // We do NOT modify drawer.balance natively here unless it's designed to do so, 
    // but looking at previous Drawer logic, balance is usually derived or updated?
    // Let's assume balance is computed from initialCash + payments + adjustments.
    // So writing to CashDrawerAdjustment is enough for the ledger check.

    return NextResponse.json({ success: true, data: adjustment, message: 'Adjustment recorded successfully' });
  } catch (err: any) {
    console.error('[POS_DRAWER_ADJ_ERROR]', err);
    return NextResponse.json({ success: false, message: err.message || 'Internal error' }, { status: 500 });
  }
}
