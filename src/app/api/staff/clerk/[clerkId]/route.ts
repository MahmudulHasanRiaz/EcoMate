import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';
import { getStaffPerformance } from '@server/utils/staff-performance';
import { ensureSalaryAccrualsForStaff } from '@server/utils/staff-salary-accrual';
import { getMonthRangeInStoreTz } from '@/lib/timezone';
import { apiForbidden } from '@/lib/error';

function normalizeRoleToken(role?: string | null): string {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
}

function isManagerClassRole(role?: string | null): boolean {
  const normalized = normalizeRoleToken(role);
  return normalized.includes('manager');
}

function canCallCentreManagerViewCallTeam(actorRole?: string | null, targetRole?: string | null): boolean {
  const actor = normalizeRoleToken(actorRole);
  const target = normalizeRoleToken(targetRole);
  return actor === 'callcentremanager' && (target === 'callassistant' || target === 'callcentremanager');
}

function hasBusinessOverlap(actorBusinessIds: string[], targetBusinessIds: string[]): boolean {
  if (!actorBusinessIds.length || !targetBusinessIds.length) return false;
  const actorSet = new Set(actorBusinessIds);
  return targetBusinessIds.some((id) => actorSet.has(id));
}

function mapIncome(income: any) {
  const refDateStr = income.referenceDate instanceof Date ? income.referenceDate.toISOString().slice(0, 10) : income.referenceDate;
  const createdStr = income.createdAt instanceof Date ? income.createdAt.toISOString().slice(0, 10) : income.createdAt;
  return {
    referenceDate: refDateStr || null,
    createdAt: createdStr || null,
    date: refDateStr || createdStr || null,
    orderId: income.orderId || '',
    orderNumber: income.order?.orderNumber || null,
    action: income.action,
    amount: Number(income.amount || 0),
    notes: income.notes || null,
  };
}

function mapStaff(
  member: any,
  allBusinesses: { id: string }[],
  incomeTotal = 0,
  incomeHistory: any[] = [],
  performance = {
    ordersCreated: 0,
    ordersConfirmed: 0,
    ordersWorked: 0,
    totalOrderActions: 0,
    incompleteWorked: 0,
    incompleteConverted: 0,
    incompleteConversionRate: 0,
    statusBreakdown: {} as Record<string, number>,
    createdStatusBreakdown: {} as Record<string, number>,
    confirmedStatusBreakdown: {} as Record<string, number>
  },
  finesTotal = 0,
  fineHistory: any[] = [],
) {
  const totalPaid =
    member.payments?.reduce((acc: number, p: any) => {
      const amount = Number(p.amount || 0);
      const checkAmount = Math.max(0, Math.min(Number(p.check || 0), amount));
      const cashPortion = Math.max(0, amount - checkAmount);
      let checkPortion = 0;
      if (checkAmount > 0) {
        if (!p.checkStatus || p.checkStatus === 'Pending' || p.checkStatus === 'Passed') {
          checkPortion = checkAmount;
        }
      }
      return acc + cashPortion + checkPortion;
    }, 0) || 0;
  const totalEarned = incomeTotal;
  const dueAmount = Math.max(0, totalEarned - totalPaid - finesTotal);

  const isAdmin = member.role === 'Admin';
  const accessibleBusinessIds = isAdmin
    ? allBusinesses.map((b) => b.id)
    : member.accessibleBusinesses?.map((b: any) => b.id) || [];

  return {
    id: member.id,
    clerkId: member.clerkId,
    staffCode: member.staffCode,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role,
    workType: member.workType,
    designation: member.designation,
    accessibleBusinessIds,
    lastLogin: member.lastLogin?.toISOString?.() ?? new Date().toISOString(),
    createdAt: member.createdAt?.toISOString?.() ?? new Date().toISOString(),
    paymentType: member.paymentType,
    salaryDetails: normalizeSalaryDetails(member.paymentType, member.salaryDetails),
    commissionDetails: normalizeCommissionDetails(member.paymentType, member.commissionDetails),
    performance,
    financials: {
      totalEarned,
      totalPaid,
      totalFines: finesTotal,
      dueAmount,
    },
    paymentHistory:
      member.payments?.map((p: any) => ({
        date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : p.date,
        amount: p.amount,
        notes: p.notes || '',
        check: Number(p.check || 0),
        checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : null,
        checkStatus: p.checkStatus ?? undefined,
      })) || [],
    incomeHistory,
    fineHistory,
    permissions: member.permissions,
    jobStartDate: member.jobStartDate instanceof Date ? member.jobStartDate.toISOString().slice(0, 10) : member.jobStartDate || null,
    jobEndDate: member.jobEndDate instanceof Date ? member.jobEndDate.toISOString().slice(0, 10) : member.jobEndDate || null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clerkId: string }> },
) {
  try {
    const { clerkId } = await params;
    const { allowed, error, staff } = await enforcePermission('staff', 'read');
    if (!staff) return error;
    if (!allowed) {
      if (!staff || staff.clerkId !== clerkId) return error;
    }

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');
    let range: { start: Date; end: Date } | undefined;
    if (fromParam || toParam) {
      const parsedFrom = fromParam ? new Date(fromParam) : undefined;
      const parsedTo = toParam ? new Date(toParam) : undefined;
      const start = parsedFrom || parsedTo;
      const end = parsedTo || parsedFrom;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 422 });
      }
      range = { start, end };
    } else {
      const month = monthParam ? Number(monthParam) : NaN;
      const year = yearParam ? Number(yearParam) : NaN;
      range = Number.isFinite(month) && Number.isFinite(year)
        ? await getMonthRangeInStoreTz(year, month)
        : undefined;
    }

    const [member, allBusinesses] = await Promise.all([
      prisma.staffMember.findFirst({
        where: { clerkId },
        include: {
          accessibleBusinesses: true,
          payments: { orderBy: { date: 'desc' } },
          StaffFine: {
            where: { status: 'Active' },
            orderBy: { date: 'desc' }
          }
        },
      }),
      prisma.business.findMany({ select: { id: true } }),
    ]);

    if (!member) return new NextResponse('Not Found', { status: 404 });

    const actorRole = staff.role;
    const actorIsAdmin = normalizeRoleToken(actorRole) === 'admin';
    const isSelf = staff.clerkId === member.clerkId || staff.id === member.id;
    const actorIsManagerClass = isManagerClassRole(actorRole);
    const callTeamBypass = canCallCentreManagerViewCallTeam(actorRole, member.role);
    if (!actorIsAdmin && actorIsManagerClass && !isSelf && !callTeamBypass) {
      const actorBusinessIds = Array.isArray(staff.accessibleBusinessIds) ? staff.accessibleBusinessIds : [];
      const targetBusinessIds = (member.accessibleBusinesses || []).map((b: any) => b.id);
      // Only block when both sides have explicit business scopes and they do not overlap.
      // If one side has no scope mapped yet, avoid false-deny on profile view.
      if (actorBusinessIds.length > 0 && targetBusinessIds.length > 0 && !hasBusinessOverlap(actorBusinessIds, targetBusinessIds)) {
        return apiForbidden('You can only view staff within your business scope');
      }
    }

    await ensureSalaryAccrualsForStaff({
      id: member.id,
      paymentType: member.paymentType,
      salaryDetails: member.salaryDetails,
      createdAt: member.createdAt,
      jobStartDate: member.jobStartDate,
      jobEndDate: member.jobEndDate,
    });

    const [memberIncomes, performance] = await Promise.all([
      prisma.staffIncome.findMany({
        where: { staffId: member.id },
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { orderNumber: true } } },
      }),
      getStaffPerformance(member.id, range),
    ]);
    const incomeHistory = memberIncomes.map(mapIncome);
    const incomeTotal = incomeHistory.reduce((acc, item) => acc + Number(item.amount || 0), 0);

    const fineHistory = (member as any).StaffFine?.map((f: any) => ({
      id: f.id,
      staffId: f.staffId,
      date: f.date instanceof Date ? f.date.toISOString().slice(0, 10) : f.date,
      amount: f.amount,
      reason: f.reason,
      notes: f.notes,
      status: f.status
    })) || [];
    const finesTotal = fineHistory.reduce((acc: number, f: any) => acc + Number(f.amount || 0), 0);

    return NextResponse.json(mapStaff(member, allBusinesses, incomeTotal, incomeHistory, performance, finesTotal, fineHistory));
  } catch (error) {
    console.error('[API_ERROR:GET_STAFF_BY_CLERK]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
