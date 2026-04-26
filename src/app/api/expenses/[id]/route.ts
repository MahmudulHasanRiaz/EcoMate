import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { OrderPlatform, ExpenseApprovalStatus } from '@prisma/client';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { deleteExpense, updateExpense } from '@/server/modules/expenses';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.expenses;
    if (perm && !perm.read) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { ExpenseCategory: true, Business: true },
    });
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    if (expense.businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(expense.businessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      id: expense.id,
      date: expense.date.toISOString(),
      category: expense.ExpenseCategory?.name ?? 'Unknown',
      categoryId: expense.categoryId,
      amount: expense.amount,
      notes: expense.notes ?? undefined,
      isAdExpense: expense.isAdExpense,
      isPaid: expense.isPaid,
      payableAccountId: expense.payableAccountId ?? undefined,
      check: Number(expense.check ?? 0),
      checkDate: expense.checkDate ? expense.checkDate.toISOString() : undefined,
      checkNo: (expense as any).checkNo ?? undefined,
      checkStatus: expense.checkStatus ?? undefined,
      paidAt: expense.paidAt ? expense.paidAt.toISOString() : undefined,
      businessId: expense.businessId ?? undefined,
      business: expense.Business?.name ?? undefined,
      platform: expense.platform ?? undefined,
    });
  } catch (error) {
    console.error('[API:EXPENSE_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.expenses;
    if (perm && !perm.update) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.expense.findUnique({
      where: { id },
      select: { businessId: true, approvalStatus: true, isPaid: true }
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    if (existing.businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(existing.businessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();

    // Role-based permission checks
    const userRole = auth.staff.role;
    const isAdmin = userRole === 'Admin';
    const isManager = userRole === 'Manager';
    const isFinance = userRole === 'FinanceManager';

    if (body.approvalStatus && body.approvalStatus !== existing.approvalStatus) {
      if (!isAdmin && !isManager) {
        return NextResponse.json({ error: 'Only Managers or Admins can approve/reject expenses' }, { status: 403 });
      }
    }

    if (body.isPaid === true && !existing.isPaid) {
      if (!isAdmin && !isFinance) {
        return NextResponse.json({ error: 'Only Finance Managers or Admins can mark expenses as paid' }, { status: 403 });
      }
    }

    const effectiveStatus = body.approvalStatus ?? existing.approvalStatus;
    if (body.isPaid === true && effectiveStatus !== 'Approved') {
      return NextResponse.json({ error: 'Expense must be Approved before payment is recorded' }, { status: 400 });
    }

    const nextBusinessId =
      typeof body?.businessId === 'string' && body.businessId.trim() ? body.businessId : null;
    if (nextBusinessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(nextBusinessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const expense = await updateExpense(id, {
      date: typeof body?.date === 'string' ? body.date : undefined,
      categoryId: typeof body?.categoryId === 'string' ? body.categoryId : undefined,
      amount: typeof body?.amount !== 'undefined' ? Number(body.amount) : undefined,
      notes: typeof body?.notes === 'string' ? body.notes : undefined,
      businessId: typeof body?.businessId !== 'undefined' ? nextBusinessId : undefined,
      branchId: typeof body?.branchId !== 'undefined'
        ? (typeof body.branchId === 'string' && body.branchId.trim() ? body.branchId : null)
        : undefined,
      isAdExpense: typeof body?.isAdExpense === 'boolean' ? body.isAdExpense : undefined,
      platform: typeof body?.platform !== 'undefined' ? ((body.platform as OrderPlatform) ?? null) : undefined,
      isPaid: typeof body?.isPaid === 'boolean' ? body.isPaid : undefined,
      paidFromAccountId:
        typeof body?.paidFromAccountId === 'string' ? body.paidFromAccountId : undefined,
      payableAccountId:
        typeof body?.payableAccountId === 'string' ? body.payableAccountId : undefined,
      check: typeof body?.check === 'number' || typeof body?.check === 'string' ? Number(body.check) : undefined,
      checkDate: typeof body?.checkDate === 'string' ? body.checkDate : undefined,
      checkNo: typeof body?.checkNo === 'string' ? body.checkNo : undefined,
      checkStatus: typeof body?.checkStatus === 'string' ? body.checkStatus : undefined,
      paidAt: typeof body?.paidAt === 'string' ? body.paidAt : undefined,

      approvalStatus: body.approvalStatus as ExpenseApprovalStatus | undefined,
      rejectionNote: body.rejectionNote,
      approvedById: body.approvalStatus === 'Approved' ? auth.staff.id : undefined,
      approvedByName: body.approvalStatus === 'Approved' ? auth.staff.name : undefined,
      rejectedById: body.approvalStatus === 'Rejected' ? auth.staff.id : undefined,
      rejectedByName: body.approvalStatus === 'Rejected' ? auth.staff.name : undefined,
      paidById: body.isPaid === true ? auth.staff.id : undefined,
      paidByName: body.isPaid === true ? auth.staff.name : undefined,
    });

    return NextResponse.json(expense);
  } catch (error: any) {
    const message = error?.message || 'Failed to update expense';
    console.error('[API:EXPENSE_PATCH]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.expenses;
    if (perm && !perm.delete) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.expense.findUnique({ where: { id }, select: { businessId: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    if (existing.businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(existing.businessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await deleteExpense(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API:EXPENSE_DELETE]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
