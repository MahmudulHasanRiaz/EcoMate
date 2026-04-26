import { NextRequest, NextResponse } from 'next/server';
import { OrderPlatform, ExpenseApprovalStatus } from '@prisma/client';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { createExpense, getExpenses } from '@/server/modules/expenses';

function parseDateParam(value: string | null) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.expenses;
    if (perm && !perm.read) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = req.nextUrl;
    const categoryId = url.searchParams.get('categoryId') || undefined;
    const businessId = url.searchParams.get('businessId') || undefined;
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));
    const isAdExpenseParam = url.searchParams.get('isAdExpense');
    const isAdExpense =
      typeof isAdExpenseParam === 'string' ? isAdExpenseParam === 'true' : undefined;
    const platformParam = url.searchParams.get('platform') || undefined;
    let platform: OrderPlatform | undefined = undefined;
    if (platformParam) {
      const validPlatforms = new Set(Object.values(OrderPlatform));
      if (!validPlatforms.has(platformParam as OrderPlatform)) {
        return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
      }
      platform = platformParam as OrderPlatform;
    }

    const pageSizeParam = url.searchParams.get('pageSize');
    const searchParam = url.searchParams.get('search');
    const cursor = url.searchParams.get('cursor') || undefined;
    const includeTotal = url.searchParams.get('includeTotal') === 'true';

    const pageSize = pageSizeParam ? parseInt(pageSizeParam) : undefined;
    const search = searchParam || undefined;

    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];

    const branchIdParam = url.searchParams.get('branchId');
    const branchId = branchIdParam === 'null' ? null : (branchIdParam || undefined);
    const branchIdsParam = url.searchParams.getAll('branchIds');
    let includeNullBranch = false;
    let branchIds: string[] | undefined = undefined;
    
    if (branchIdsParam.length > 0) {
      if (branchIdsParam.includes('__NULL__')) {
        includeNullBranch = true;
      }
      const filtered = branchIdsParam.filter(id => id !== '__NULL__');
      if (filtered.length > 0) {
        branchIds = filtered;
      }
    }

    const expensesPage = await getExpenses({
      categoryId,
      businessId,
      branchId,
      branchIds,
      includeNullBranch,
      from,
      to,
      isAdExpense,
      platform,
      accessibleBusinessIds,
      pageSize,
      cursor,
      search,
      includeTotal,
    });

    return NextResponse.json(expensesPage);
  } catch (error) {
    console.error('[API:EXPENSES_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const perm = auth.staff?.permissions?.expenses;
    if (perm && !perm.create) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const businessId: string | null | undefined =
      typeof body?.businessId === 'string' && body.businessId.trim() ? body.businessId : null;
    const accessibleBusinessIds: string[] = Array.isArray(auth.staff?.accessibleBusinessIds)
      ? auth.staff.accessibleBusinessIds
      : [];
    if (businessId && accessibleBusinessIds.length && !accessibleBusinessIds.includes(businessId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const approvalStatus = (body?.approvalStatus as ExpenseApprovalStatus | undefined)
      ?? (body?.staffPaymentId ? 'Approved' : 'Submitted');

    if (body?.isPaid === true && approvalStatus !== 'Approved') {
      return NextResponse.json({ error: 'Expense must be Approved before payment is recorded' }, { status: 400 });
    }

    const expense = await createExpense({
      date: String(body?.date ?? ''),
      categoryId: String(body?.categoryId ?? ''),
      amount: Number(body?.amount ?? 0),
      notes: typeof body?.notes === 'string' ? body.notes : null,
      isAdExpense: Boolean(body?.isAdExpense),
      platform: (body?.platform as OrderPlatform | undefined) ?? null,
      businessId,
      branchId: typeof body?.branchId === 'string' && body.branchId.trim() ? body.branchId : null,
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
      approvalStatus,
      submittedById: auth.staff.id,
      submittedByName: auth.staff.name,
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to create expense';
    console.error('[API:EXPENSES_POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
