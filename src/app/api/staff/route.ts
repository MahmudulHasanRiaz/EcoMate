import { NextResponse, type NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { clerkClient } from '@clerk/nextjs/server';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError } from '@/lib/error';
import { createStaffSchema } from '@/lib/validations/staff';
import { getPresetPermissions } from '@/lib/permissions';
import { attachPageAccess } from '@/lib/page-access';

import { getStaffListServer } from '@/server/modules/staff-list';

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

function mapStaff(member: any, avatarUrl?: string | null, incomeTotal = 0, paidTotal?: number, finesTotal = 0) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  // Use paidTotal if provided (including 0), fallback to raw sum only if undefined
  const totalPaid =
    paidTotal !== undefined
      ? paidTotal
      : payments.reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
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
    role: member.role,
    workType: member.workType,
    designation: member.designation,
    weekendDays: member.weekendDays,
    shiftOverride: member.staffShiftOverride?.[0] ? {
      startTime: member.staffShiftOverride[0].startTime,
      endTime: member.staffShiftOverride[0].endTime,
      lateGraceMinutes: member.staffShiftOverride[0].lateGraceMinutes,
      earlyLeaveGraceMinutes: member.staffShiftOverride[0].earlyLeaveGraceMinutes,
    } : null,
    accessibleBusinessIds: member.accessibleBusinesses?.map((b: any) => b.id) || [],
    lastLogin: member.lastLogin?.toISOString?.() ?? new Date().toISOString(),
    createdAt: member.createdAt?.toISOString?.() ?? new Date().toISOString(),
    jobStartDate: member.jobStartDate instanceof Date ? member.jobStartDate.toISOString().slice(0, 10) : member.jobStartDate || null,
    jobEndDate: member.jobEndDate instanceof Date ? member.jobEndDate.toISOString().slice(0, 10) : member.jobEndDate || null,
    paymentType: member.paymentType,
    overtimeEligible: member.overtimeEligible,
    overtimeBonusPercent: member.overtimeBonusPercent,
    salaryDetails: normalizeSalaryDetails(member.paymentType, member.salaryDetails),
    commissionDetails: normalizeCommissionDetails(member.paymentType, member.commissionDetails),
    performance: {
      ordersCreated: 0,
      ordersConfirmed: 0,
      ordersWorked: 0,
      totalOrderActions: 0,
      incompleteWorked: 0,
      incompleteConverted: 0,
      incompleteConversionRate: 0,
      statusBreakdown: {},
    },
    financials: {
      totalEarned,
      totalPaid,
      totalFines: finesTotal,
      dueAmount,
    },
    paymentHistory: payments.map((p: any) => ({
      date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : p.date,
      amount: p.amount,
      notes: p.notes || '',
      check: Number(p.check || 0),
      checkDate: p.checkDate ? p.checkDate.toISOString().slice(0, 10) : null,
      checkStatus: p.checkStatus ?? undefined,
    })) || [],
    incomeHistory: [],
    permissions: member.permissions,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'read');
    if (!allowed) return error;

    const { searchParams } = new URL(request.url);
    const data = await getStaffListServer({
      page: Number(searchParams.get('page') || '1'),
      pageSize: Number(searchParams.get('pageSize') || '20'),
      search: searchParams.get('search')?.trim() || '',
      role: searchParams.get('role')?.trim() || '',
      designation: searchParams.get('designation')?.trim() || '',
      workType: searchParams.get('workType')?.trim() || '',
      includeInvites: searchParams.get('includeInvites') === 'true',
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API_ERROR:GET_STAFF]', error);
    // Fallback to empty structure to avoid breaking clients
    return NextResponse.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: 0,
      summary: { totalEarned: 0, totalPaid: 0, totalFines: 0, totalDue: 0 },
      uniqueDesignations: [],
    }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'create');
    if (!allowed) return error;

    const body = await request.json();
    const parsed = createStaffSchema.safeParse(body);
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
      staffCode: providedStaffCode,
      clerkId,
      designation,
      weekendDays,
      shiftOverride,
      overtimeEligible,
      overtimeBonusPercent,
      workType,
    } = parsed.data;

    const dbRole = uiToDbRole[role] || role;

    let businessIdsToGrant = accessibleBusinessIds ?? [];
    if (dbRole === 'Admin' || ((dbRole === 'Manager' || dbRole === 'Marketer') && accessibleBusinessIds === undefined)) {
      const allBusinesses = await prisma.business.findMany({ select: { id: true } });
      businessIdsToGrant = allBusinesses.map((b) => b.id);
    }

    const basePermissions = role === 'Custom' ? permissions : getPresetPermissions(role);
    const effectivePermissions = attachPageAccess(basePermissions || {}, role);
    const { generateStaffCode } = await import('@server/utils/staffCode');
    let staffCode = providedStaffCode || await generateStaffCode();
    const normSalary = normalizeSalaryDetails(paymentType, salaryDetails);
    const normCommission = normalizeCommissionDetails(paymentType, commissionDetails);

    const isStaffCodeConflict = (error: any) => {
      if (error?.code !== 'P2002') return false;
      const target = error?.meta?.target;
      if (Array.isArray(target)) return target.includes('staffCode');
      return typeof target === 'string' && target.includes('staffCode');
    };

    let newMember: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        newMember = await prisma.staffMember.create({
          data: {
            staffCode,
            name,
            email,
            phone,
            role: dbRole,
            clerkId: clerkId || `local_${Date.now()}`,
            lastLogin: new Date(),
            paymentType,
            salaryDetails: normSalary,
            commissionDetails: normCommission,
            designation,
            workType,
            weekendDays,
            overtimeEligible,
            overtimeBonusPercent: overtimeBonusPercent ?? 0,
            permissions: effectivePermissions || {},
            accessibleBusinesses: {
              connect: businessIdsToGrant.map((id: string) => ({ id })),
            },
          } as any,
          include: { accessibleBusinesses: true, payments: true },
        });
        break;
      } catch (error: any) {
        if (!isStaffCodeConflict(error)) throw error;
        staffCode = await generateStaffCode();
      }
    }
    if (!newMember) {
      throw new Error('Failed to assign a unique staff code.');
    }

    if (shiftOverride) {
      const createdOverride = await prisma.staffShiftOverride.create({
        data: {
          staffId: newMember.id,
          startTime: shiftOverride.startTime,
          endTime: shiftOverride.endTime,
          lateGraceMinutes: shiftOverride.lateGraceMinutes ?? 0,
          earlyLeaveGraceMinutes: shiftOverride.earlyLeaveGraceMinutes ?? 0,
        },
      });
      newMember.staffShiftOverride = [createdOverride];
    }

    return NextResponse.json(mapStaff(newMember), { status: 201 });
  } catch (error: any) {
    console.error('[API_ERROR:CREATE_STAFF]', error);
    if (error.code === 'P2002') {
      return apiError('Staff email or clerkId already exists', 409);
    }
    return apiServerError(error);
  }
}
