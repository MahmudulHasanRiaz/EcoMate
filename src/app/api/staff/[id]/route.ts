import { NextResponse, type NextRequest } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { getPresetPermissions } from '@/lib/permissions';
import { attachPageAccess } from '@/lib/page-access';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';
import { getStaffPerformance } from '@server/utils/staff-performance';
import { ensureSalaryAccrualsForStaff } from '@server/utils/staff-salary-accrual';
import { getMonthRangeInStoreTz } from '@/lib/timezone';
import { enforcePermission } from '@/lib/security';
import { apiError, apiForbidden, apiNotFound, apiServerError } from '@/lib/error';
import { updateStaffSchema } from '@/lib/validations/staff';

const uiToDbRole: Record<string, string> = {
  Admin: 'Admin',
  Manager: 'Manager',
  'Packing Assistant': 'PackingAssistant',
  Moderator: 'Moderator',
  Seller: 'Seller',
  'Call Assistant': 'CallAssistant',
  'Call Centre Manager': 'CallCentreManager',
  'Courier Manager': 'CourierManager',
  'Courier Call Assistant': 'CourierCallAssistant',
  Partner: 'Vendor_Supplier',
  'Vendor/Supplier': 'Vendor_Supplier',
  'Cutting Master': 'CuttingMan',
  Marketer: 'Marketer',
  'Finance Manager': 'FinanceManager',
  'Project Manager': 'ProjectManager',
  'Modarator Manager': 'ModaratorManager',
  Custom: 'Custom',
};

const dbToUiRole: Record<string, string> = {
  Admin: 'Admin',
  Manager: 'Manager',
  PackingAssistant: 'Packing Assistant',
  Moderator: 'Moderator',
  Seller: 'Seller',
  CallAssistant: 'Call Assistant',
  CallCentreManager: 'Call Centre Manager',
  CourierManager: 'Courier Manager',
  CourierCallAssistant: 'Courier Call Assistant',
  Vendor_Supplier: 'Vendor/Supplier',
  CuttingMan: 'Cutting Master',
  Marketer: 'Marketer',
  FinanceManager: 'Finance Manager',
  ProjectManager: 'Project Manager',
  ModaratorManager: 'Modarator Manager',
  Custom: 'Custom',
};

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
  avatarUrl?: string | null,
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
    statusBreakdown: {},
    createdStatusBreakdown: {},
    confirmedStatusBreakdown: {}
  },
  finesTotal = 0,
  paidTotal?: number,
) {
  const totalPaid =
    paidTotal !== undefined
      ? paidTotal
      : member.payments?.reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0) || 0;
  const totalEarned = incomeTotal;
  const dueAmount = Math.max(0, totalEarned - totalPaid - finesTotal);

  return {
    id: member.id,
    clerkId: member.clerkId,
    staffCode: member.staffCode,
    avatarUrl: avatarUrl || member.avatarUrl || null,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: dbToUiRole[member.role] || member.role,
    workType: member.workType,
    designation: member.designation,
    accessibleBusinessIds: member.accessibleBusinesses?.map((b: any) => b.id) || [],
    accessibleBusinesses: member.accessibleBusinesses?.map((b: any) => ({ id: b.id, name: b.name })) || [],
    lastLogin: member.lastLogin?.toISOString?.() ?? new Date().toISOString(),
    createdAt: member.createdAt?.toISOString?.() ?? new Date().toISOString(),
    paymentType: member.paymentType,
    overtimeEligible: member.overtimeEligible,
    overtimeBonusPercent: member.overtimeBonusPercent,
    salaryDetails: normalizeSalaryDetails(member.paymentType, member.salaryDetails),
    commissionDetails: normalizeCommissionDetails(member.paymentType, member.commissionDetails),
    performance,
    financials: {
      totalEarned,
      totalPaid,
      totalFines: finesTotal,
      dueAmount,
    },
    paymentHistory: member.payments?.map((p: any) => ({
      date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : p.date,
      amount: p.amount,
      notes: p.notes || '',
      check: Number(p.check || 0),
      checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : null,
      checkStatus: p.checkStatus ?? undefined,
      paidFromAccountId: p.paidFromAccountId,
    })) || [],
    incomeHistory,
    permissions: member.permissions,
    shiftOverride: member.StaffShiftOverride?.[0] ? {
      startTime: member.StaffShiftOverride[0].startTime,
      endTime: member.StaffShiftOverride[0].endTime,
      lateGraceMinutes: member.StaffShiftOverride[0].lateGraceMinutes,
      earlyLeaveGraceMinutes: member.StaffShiftOverride[0].earlyLeaveGraceMinutes,
    } : null,
    jobStartDate: member.jobStartDate instanceof Date ? member.jobStartDate.toISOString().slice(0, 10) : member.jobStartDate || null,
    jobEndDate: member.jobEndDate instanceof Date ? member.jobEndDate.toISOString().slice(0, 10) : member.jobEndDate || null,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { allowed, error, staff } = await enforcePermission('staff', 'read');
    if (!staff) return error;
    if (!allowed) {
      if (!staff || staff.id !== id) return error;
    }

    const searchParams = request.nextUrl.searchParams;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');
    const includeHistory = searchParams.get('includeHistory') === 'true';

    let range: { start: Date; end: Date } | undefined;
    if (fromParam || toParam) {
      const parsedFrom = fromParam ? new Date(fromParam) : undefined;
      const parsedTo = toParam ? new Date(toParam) : undefined;
      const start = parsedFrom || parsedTo;
      const end = parsedTo || parsedFrom;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return apiError('Invalid date range', 422);
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
      prisma.staffMember.findUnique({
        where: { id },
        include: { accessibleBusinesses: { select: { id: true, name: true } }, payments: includeHistory, StaffShiftOverride: { where: { isActive: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } },
      }),
      prisma.business.findMany({ select: { id: true, name: true } }),
    ]);

    if (!member) return new NextResponse('Not Found', { status: 404 });

    const actorRole = staff.role;
    const actorIsAdmin = normalizeRoleToken(actorRole) === 'admin';
    const isSelf = staff.id === member.id;
    const actorIsManagerClass = isManagerClassRole(actorRole);
    const callTeamBypass = canCallCentreManagerViewCallTeam(actorRole, member.role);
    if (!actorIsAdmin && actorIsManagerClass && !isSelf && !callTeamBypass) {
      const actorBusinessIds = Array.isArray(staff.accessibleBusinessIds) ? staff.accessibleBusinessIds : [];
      const targetBusinessIds = (member.accessibleBusinesses || []).map((b: any) => b.id);
      if (actorBusinessIds.length > 0 && targetBusinessIds.length > 0 && !hasBusinessOverlap(actorBusinessIds, targetBusinessIds)) {
        return apiForbidden('You can only view staff within your business scope');
      }
    }

    const [incomes, performance] = await Promise.all([
      includeHistory
        ? prisma.staffIncome.findMany({
          where: { staffId: id },
          orderBy: { createdAt: 'desc' },
          include: { order: { select: { orderNumber: true } } },
        })
        : Promise.resolve([]),
      getStaffPerformance(id, range),
    ]);

    const { getRunningStaffPaid } = await import('@/server/modules/staff');
    let totalPaid = 0;
    if (includeHistory && member.payments) {
      totalPaid = member.payments.reduce((acc: number, p: any) => {
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
      }, 0);
    } else {
      totalPaid = await getRunningStaffPaid(id);
    }

    const { getActiveFineTotalForStaff } = await import('@/server/modules/staff-fines');
    const finesTotal = await getActiveFineTotalForStaff(id);

    let incomeTotal = 0;
    if (includeHistory) {
      incomeTotal = incomes.reduce((acc: any, item: any) => acc + Number(item.amount || 0), 0);
    } else {
      const aggr = await prisma.staffIncome.aggregate({ where: { staffId: id }, _sum: { amount: true } });
      incomeTotal = Number(aggr._sum.amount || 0);
    }

    let avatarUrl: string | null | undefined = null;
    if (member.clerkId) {
      try {
        const client = await clerkClient();
        const clerkUser = await client.users.getUser(member.clerkId);
        avatarUrl = clerkUser.imageUrl || null;
      } catch (err) {
        console.warn('[API_WARNING:CLERK_AVATAR_SINGLE]', err);
      }
    }

    const isAdmin = member.role === 'Admin';
    const incomeHistory = Array.isArray(incomes) ? incomes.map(mapIncome) : [];

    const mapped = mapStaff(
      {
        ...member,
        accessibleBusinesses: isAdmin ? allBusinesses : member.accessibleBusinesses,
      },
      avatarUrl,
      incomeTotal,
      incomeHistory,
      performance,
      finesTotal,
      totalPaid,
    );

    return NextResponse.json(mapped);
  } catch (error) {
    console.error('[API_ERROR:GET_STAFF_BY_ID]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { allowed, error } = await enforcePermission('staff', 'update');
    if (!allowed) return error;

    const body = await request.json();
    const parsed = updateStaffSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('Validation failed', 422, parsed.error);
    }

    const {
      name,
      email,
      phone,
      role,
      paymentType,
      salaryDetails,
      commissionDetails,
      permissions,
      accessibleBusinessIds,
      staffCode,
      designation,
      weekendDays,
      shiftOverride,
      overtimeEligible,
      overtimeBonusPercent,
      workType,
      jobStartDate,
      jobEndDate,
    } = parsed.data;

    const existing = await prisma.staffMember.findUnique({
      where: { id },
      select: { paymentType: true, role: true, jobStartDate: true },
    });
    if (!existing) return apiNotFound('Staff not found');

    const incomingJobStart =
      jobStartDate === undefined ? undefined : (jobStartDate ? jobStartDate : null);

    if (existing.jobStartDate) {
      const existingStr = existing.jobStartDate instanceof Date
        ? existing.jobStartDate.toISOString().slice(0, 10)
        : String(existing.jobStartDate).slice(0, 10);

      if (incomingJobStart !== undefined && incomingJobStart !== existingStr) {
        return apiError('Job start date is already set and cannot be changed', 409);
      }
    }

    const effectivePaymentType = paymentType ?? existing.paymentType;
    const dbRole = role ? (uiToDbRole[role] || role) : undefined;

    let businessIdsToGrant: string[] | undefined;
    if (role === 'Admin') {
      const allBusinesses = await prisma.business.findMany({ select: { id: true } });
      businessIdsToGrant = allBusinesses.map((b) => b.id);
    } else if (accessibleBusinessIds !== undefined) {
      businessIdsToGrant = accessibleBusinessIds;
    } else if ((dbRole === 'Manager' || dbRole === 'Marketer') && existing.role !== dbRole) {
      const allBusinesses = await prisma.business.findMany({ select: { id: true } });
      businessIdsToGrant = allBusinesses.map((b) => b.id);
    }

    const data: Record<string, any> = {};
    if (staffCode !== undefined) data.staffCode = staffCode;
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (designation !== undefined) data.designation = designation;
    if (weekendDays !== undefined) data.weekendDays = weekendDays;
    if (overtimeEligible !== undefined) data.overtimeEligible = overtimeEligible;
    if (overtimeBonusPercent !== undefined) data.overtimeBonusPercent = overtimeBonusPercent;
    if (workType !== undefined) data.workType = workType;
    if (jobStartDate !== undefined && !existing.jobStartDate) {
      data.jobStartDate = jobStartDate ? new Date(jobStartDate) : null;
    }
    if (jobEndDate !== undefined) data.jobEndDate = jobEndDate ? new Date(jobEndDate) : null;
    if (dbRole) data.role = dbRole;
    if (paymentType) data.paymentType = paymentType;
    if (paymentType || salaryDetails) {
      data.salaryDetails = normalizeSalaryDetails(effectivePaymentType, salaryDetails);
    }
    if (paymentType || commissionDetails) {
      data.commissionDetails = normalizeCommissionDetails(effectivePaymentType, commissionDetails);
    }
    if (permissions) {
      data.permissions = attachPageAccess(permissions as any, dbRole || role);
    }
    if (businessIdsToGrant !== undefined) {
      data.accessibleBusinesses = {
        set: [],
        connect: businessIdsToGrant.map((businessId) => ({ id: businessId })),
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const up = await tx.staffMember.update({
        where: { id },
        data,
        include: { accessibleBusinesses: true, payments: true, StaffShiftOverride: { where: { isActive: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } },
      });

      if (shiftOverride !== undefined) {
        if (shiftOverride === null) {
          await tx.staffShiftOverride.updateMany({
            where: { staffId: id, isActive: true },
            data: { isActive: false },
          });
        } else {
          await tx.staffShiftOverride.updateMany({
            where: { staffId: id, isActive: true },
            data: { isActive: false },
          });
          await tx.staffShiftOverride.create({
            data: {
              staffId: id,
              startTime: shiftOverride.startTime,
              endTime: shiftOverride.endTime,
              lateGraceMinutes: shiftOverride.lateGraceMinutes ?? 0,
              earlyLeaveGraceMinutes: shiftOverride.earlyLeaveGraceMinutes ?? 0,
            },
          });
        }
      }

      if (existing.role === 'CuttingMan' && up.role !== 'CuttingMan') {
        await tx.staffIncome.deleteMany({
          where: { staffId: id, action: 'Cutting' }
        });

        await tx.productionStep.updateMany({
          where: { assignedStaffId: id, stepType: 'CUTTING' },
          data: { assignedStaffId: null, cuttingType: 'EXTERNAL' }
        });
      }

      return up;
    });

    if (updated.clerkId) {
      try {
        const client = await clerkClient();
        const clerkUser = await client.users.getUser(updated.clerkId);
        const prevMetadata = clerkUser.publicMetadata || {};
        const uiRole = dbToUiRole[updated.role] || updated.role;
        await client.users.updateUser(updated.clerkId, {
          publicMetadata: {
            ...prevMetadata,
            name: updated.name,
            role: uiRole,
            phone: updated.phone,
            permissions: updated.permissions,
            accessibleBusinessIds: updated.accessibleBusinesses?.map((b) => b.id) || [],
            paymentType: updated.paymentType,
            salaryDetails: updated.salaryDetails,
            commissionDetails: updated.commissionDetails,
            staffId: updated.id,
            staffCode: updated.staffCode,
            designation: updated.designation,
            workType: updated.workType,
            overtimeEligible: updated.overtimeEligible,
            overtimeBonusPercent: updated.overtimeBonusPercent,
          },
        });
      } catch (err) {
        console.warn('[API_WARNING:STAFF_METADATA_SYNC]', err);
      }
    }

    const incomeSummary = await prisma.staffIncome.aggregate({
      where: { staffId: updated.id },
      _sum: { amount: true },
    });
    const incomeTotal = Number(incomeSummary._sum.amount || 0);

    return NextResponse.json(mapStaff(updated, undefined, incomeTotal));
  } catch (error) {
    console.error('[API_ERROR:UPDATE_STAFF]', error);
    return apiServerError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { allowed, error } = await enforcePermission('staff', 'delete');
    if (!allowed) return error;

    const staff = await prisma.staffMember.findUnique({
      where: { id },
      select: { id: true, email: true, clerkId: true },
    });

    if (!staff) {
      return new NextResponse('Not Found', { status: 404 });
    }

    await prisma.$transaction([
      prisma.staffInvite.deleteMany({ where: { email: staff.email } }),
      prisma.staffMember.delete({ where: { id } }),
    ]);

    if (staff.clerkId) {
      try {
        const client = await clerkClient();
        await client.users.deleteUser(staff.clerkId);
      } catch (err) {
        console.warn('[STAFF_DELETE] Clerk user delete failed (continuing):', err);
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[API_ERROR:DELETE_STAFF]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
