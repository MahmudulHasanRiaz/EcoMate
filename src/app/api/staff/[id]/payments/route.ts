import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { getStaffPaymentsPaginated } from '@/server/modules/staff';
import { CheckPassingSource } from '@prisma/client';
import {
  buildCheckPassingItemFromStaffPayment,
  upsertCheckPassingItem,
  deleteCheckPassingItem
} from '@/server/modules/check-passing-items';
import { ACCOUNT_LABELS, ensureDefaultAccounts, resolveLedgerEntryNumber } from '@/server/modules/accounting';
import { revalidateTags } from '@/server/utils/revalidate';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { allowed, error, staff } = await enforcePermission('staff', 'read');
    if (!allowed) {
      if (!staff || staff.id !== id) return error;
    }

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get('cursor') || undefined;
    const pageSize = Number(searchParams.get('pageSize')) || 50;

    const result = await getStaffPaymentsPaginated({ staffId: id, cursor, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API_ERROR:GET_STAFF_PAYMENTS]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: staffId } = await params;
    const { allowed, error } = await enforcePermission('staff', 'update');
    if (!allowed) return error;

    const body = await request.json();
    const amount = Number(body.amount);
    const notes = String(body.notes || '').trim();
    const paidFromAccountId = body.paidFromAccountId || null;
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    const check = typeof body.check === 'number' ? body.check : 0;
    const checkDate = body.checkDate ? new Date(body.checkDate) : null;
    const checkNo = body.checkNo || null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Validate check fields
    if (check > 0 && !checkDate) {
      return NextResponse.json({ error: 'Check payment requires a check passing date.' }, { status: 400 });
    }
    if (check > 0 && !checkNo) {
      return NextResponse.json({ error: 'Check payment requires a check number.' }, { status: 400 });
    }

    // Enforce cash drawer for cash transactions
    if (paidFromAccountId) {
      const account = await prisma.account.findUnique({ where: { id: paidFromAccountId } });
      if (account && account.name.toLowerCase().includes('cash')) {
        try {
          const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
          await assertCashDrawerAccount(paidFromAccountId);
        } catch (err: any) {
           return NextResponse.json({ error: err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.' }, { status: 400 });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create staff payment
      const payment = await tx.staffPayment.create({
        data: {
          staffId,
          amount,
          notes,
          date: paidAt,
          paidFromAccountId,
          check,
          checkDate,
          checkNo,
          checkStatus: check > 0 ? 'Pending' : undefined,
        },
        include: { staff: true },
      });

      // Sync CheckPassingItem
      if (check > 0 && checkDate) {
        const checkItem = await buildCheckPassingItemFromStaffPayment(tx, payment.id);
        if (checkItem) await upsertCheckPassingItem(tx, checkItem);
      } else {
        await deleteCheckPassingItem(tx, CheckPassingSource.Staff, payment.id);
      }

      // Post ledger entries using cleared-funds logic
      const { rebuildStaffPaymentLedger } = await import('@/server/modules/staff-payment-ledger');
      await rebuildStaffPaymentLedger(tx, payment.id);

      return payment;
    });

    // --- Fire SMS Notification ---
    try {
      const { getRunningStaffPaid } = await import('@/server/modules/staff');
      const { getActiveFineTotalForStaff } = await import('@/server/modules/staff-fines');

      const incomeAgg = await prisma.staffIncome.aggregate({
        where: { staffId },
        _sum: { amount: true },
      });
      const totalEarned = Number(incomeAgg._sum.amount || 0);
      const totalPaid = await getRunningStaffPaid(staffId);
      const finesTotal = await getActiveFineTotalForStaff(staffId);
      const due = Math.max(0, totalEarned - totalPaid - finesTotal);

      const { sendStaffPaymentSms } = await import('@/server/modules/sms-notifications');
      await sendStaffPaymentSms(staffId, amount, due);
    } catch (e) {
      console.error('[SMS_TRIGGER_ERROR_STAFF_PAYMENT]', e);
    }
    // -----------------------------

    await revalidateTags(['staff']);

    return NextResponse.json({
      success: true,
      payment: {
        id: result.id,
        amount: result.amount,
        date: result.date,
        notes: result.notes,
        check: result.check,
        checkDate: result.checkDate,
        checkNo: result.checkNo,
        checkStatus: result.checkStatus,
      }
    }, { status: 201 });
  } catch (error) {
    console.error('[API_ERROR:CREATE_STAFF_PAYMENT]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
