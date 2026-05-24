import prisma from '@/lib/prisma';
import { clerkClient } from '@clerk/nextjs/server';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';
import { batchGetStaffListPerformance } from '@server/utils/staff-performance';
import { attachPageAccess } from '@/lib/page-access';
import { StaffMemberUI, StaffRole } from '@/types';

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
  Partner: 'VendorSupplier',
  'Vendor/Supplier': 'VendorSupplier',
  'Cutting Master': 'CuttingMan',
  Marketer: 'Marketer',
  'Finance Manager': 'FinanceManager',
  'Project Manager': 'ProjectManager',
  'Modarator Manager': 'ModaratorManager',
  'Sales Representative': 'SalesRepresentative',
  Custom: 'Custom',
};

const dbToUiRole: Record<string, StaffRole> = {
    Admin: 'Admin',
    Manager: 'Manager',
    PackingAssistant: 'Packing Assistant',
    Moderator: 'Moderator',
    Seller: 'Seller',
    CallAssistant: 'Call Assistant',
    CallCentreManager: 'Call Centre Manager',
    CourierManager: 'Courier Manager',
    CourierCallAssistant: 'Courier Call Assistant',
    VendorSupplier: 'Vendor/Supplier',
    ProjectManager: 'Project Manager',
    ModaratorManager: 'Modarator Manager',
    CuttingMan: 'Cutting Master',
    Marketer: 'Marketer',
    FinanceManager: 'Finance Manager',
    SalesRepresentative: 'Sales Representative',
    Custom: 'Custom',
};

function mapStaff(member: any, avatarUrl?: string | null, incomeTotal = 0, paidTotal?: number, finesTotal = 0, performance?: {
    ordersCreated: number;
    ordersConfirmed: number;
    ordersWorked: number;
    totalOrderActions: number;
    incompleteWorked: number;
    incompleteConverted: number;
    incompleteConversionRate: number;
    statusBreakdown: Record<string, number>;
    createdStatusBreakdown: Record<string, number>;
    confirmedStatusBreakdown: Record<string, number>;
  }): StaffMemberUI {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  const totalPaid =
    paidTotal !== undefined
      ? paidTotal
      : payments.reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
  const totalEarned = incomeTotal;
  const dueAmount = Math.max(0, totalEarned - totalPaid - finesTotal);

  const role = dbToUiRole[member.role] || member.role as StaffRole;

  return {
    id: member.id,
    clerkId: member.clerkId || '',
    staffCode: member.staffCode || '',
    status: member.status || 'Active',
    avatarUrl: avatarUrl || member.avatarUrl || null,
    name: member.name || '',
    email: member.email || '',
    phone: member.phone || '',
    role,
    workType: member.workType || 'Remote',
    designation: member.designation || null,
    accessibleBusinessIds: member.accessibleBusinesses?.map((b: any) => b.id) || [],
    accessibleBusinesses: member.accessibleBusinesses || [],
    weekendDays: member.weekendDays ?? null,
    shiftOverride: member.StaffShiftOverride?.[0] ? {
      startTime: member.StaffShiftOverride[0].startTime,
      endTime: member.StaffShiftOverride[0].endTime,
      lateGraceMinutes: member.StaffShiftOverride[0].lateGraceMinutes,
      earlyLeaveGraceMinutes: member.StaffShiftOverride[0].earlyLeaveGraceMinutes,
    } : null,
    lastLogin: member.lastLogin?.toISOString?.() ?? (typeof member.lastLogin === 'string' ? member.lastLogin : new Date().toISOString()),
    createdAt: member.createdAt?.toISOString?.() ?? (typeof member.createdAt === 'string' ? member.createdAt : new Date().toISOString()),
    jobStartDate: member.jobStartDate instanceof Date ? member.jobStartDate.toISOString().slice(0, 10) : member.jobStartDate || null,
    jobEndDate: member.jobEndDate instanceof Date ? member.jobEndDate.toISOString().slice(0, 10) : member.jobEndDate || null,
    paymentType: member.paymentType || 'Both',
    overtimeEligible: member.overtimeEligible,
    overtimeBonusPercent: member.overtimeBonusPercent,
    salaryDetails: normalizeSalaryDetails(member.paymentType, member.salaryDetails) as StaffMemberUI['salaryDetails'],
    commissionDetails: normalizeCommissionDetails(member.paymentType, member.commissionDetails) as StaffMemberUI['commissionDetails'],
    performance: {
      ordersCreated: performance?.ordersCreated ?? 0,
      ordersConfirmed: performance?.ordersConfirmed ?? 0,
      ordersWorked: performance?.ordersWorked ?? 0,
      totalOrderActions: performance?.totalOrderActions ?? 0,
      incompleteWorked: performance?.incompleteWorked ?? 0,
      incompleteConverted: performance?.incompleteConverted ?? 0,
      incompleteConversionRate: performance?.incompleteConversionRate ?? 0,
      statusBreakdown: performance?.statusBreakdown ?? {},
      createdStatusBreakdown: performance?.createdStatusBreakdown ?? {},
      confirmedStatusBreakdown: performance?.confirmedStatusBreakdown ?? {},
    },
    financials: {
      totalEarned,
      totalPaid,
      totalFines: finesTotal,
      dueAmount,
    },
    paymentHistory: payments.map((p: any) => ({
      id: p.id,
      date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : p.date,
      amount: Number(p.amount || 0),
      notes: p.notes || '',
      check: Number(p.check || 0),
      checkDate: p.checkDate ? (p.checkDate instanceof Date ? p.checkDate.toISOString().slice(0, 10) : p.checkDate) : null,
      checkStatus: p.checkStatus ?? undefined,
      checkNo: p.checkNo || '',
      paidFromAccountId: p.paidFromAccountId || null,
      paidAt: p.paidAt instanceof Date ? p.paidAt.toISOString() : p.paidAt || null,
    })) || [],
    incomeHistory: [],
    permissions: member.permissions || {},
  };
}

export type StaffListParams = {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: string;
    designation?: string;
    includeInvites?: boolean;
    from?: string;
    to?: string;
    workType?: string;
};

export async function getStaffListServer(params: StaffListParams) {
    const {
        page: pageParam = 1,
        pageSize: pageSizeParam = 20,
        search = '',
        role: roleParam = '',
        designation: designationParam = '',
        includeInvites = false,
        from,
        to,
        workType
    } = params;

    const page = Math.max(pageParam, 1);
    const rawPageSize = pageSizeParam > 0 ? pageSizeParam : 20;
    const dbRole = roleParam && roleParam !== 'all' ? (uiToDbRole[roleParam] || roleParam) : null;
    const maxSize = 1000;
    const pageSize = Math.min(Math.max(rawPageSize, 1), maxSize);

    const where: Record<string, any> = {};
    if (dbRole) where.role = dbRole;
    if (designationParam && designationParam !== 'all') where.designation = designationParam;
    if (workType && workType !== 'all') where.workType = workType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { staffCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const shouldIncludeInvites = includeInvites && page === 1;

    const [members, invites, allBusinesses, total, designations] = await Promise.all([
      prisma.staffMember.findMany({
        where,
        include: { accessibleBusinesses: true, StaffShiftOverride: { where: { isActive: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      shouldIncludeInvites
        ? prisma.staffInvite
          .findMany({
            where: {
              usedAt: null,
              status: 'Pending' as any,
            },
            orderBy: { createdAt: 'desc' }
          })
          .catch((err) => {
            console.warn('[API_WARNING:STAFF_INVITES]', err);
            return [] as any[];
          })
        : Promise.resolve([] as any[]),
      prisma.business.findMany({ select: { id: true, name: true } }),
      prisma.staffMember.count({ where }),
      prisma.staffMember.findMany({
        where: { designation: { not: null } },
        distinct: ['designation'],
        select: { designation: true },
      }),
    ]);

    const uniqueDesignations = designations.map(d => d.designation).filter(Boolean) as string[];

    const clerkIds = members.map((m) => m.clerkId).filter(Boolean);
    let avatarMap: Record<string, string | null> = {};
    if (clerkIds.length > 0) {
      try {
        const client = await clerkClient();
        const chunkSize = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < clerkIds.length; i += chunkSize) {
          chunks.push(clerkIds.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map(async (ids) => {
            try {
              return await client.users.getUserList({ userId: ids });
            } catch (err) {
              console.warn('[API_WARNING:CLERK_AVATARS]', err);
              return null;
            }
          }),
        );

        avatarMap = Object.fromEntries(
          results
            .filter((res): res is any => !!res)
            .flatMap((res) => {
              const data = Array.isArray(res?.data) ? res.data : [];
              return data.map((u: any) => [u.id, u.imageUrl || null]);
            }),
        );
      } catch (err) {
        console.warn('[API_WARNING:CLERK_AVATARS]', err);
      }
    }

    const existingEmails = new Set(members.map((m) => m.email?.toLowerCase()).filter(Boolean));
    const memberIds = members.map((m) => m.id);
    const incomeTotals = memberIds.length
      ? await prisma.staffIncome.groupBy({
        by: ['staffId'],
        where: { staffId: { in: memberIds } },
        _sum: { amount: true },
      })
      : [];
    const incomeMap = Object.fromEntries(
      incomeTotals.map((item) => [item.staffId, Number(item._sum.amount || 0)]),
    );

    const perfRange = (from || to) ? {
      start: from ? new Date(from) : new Date(0),
      end: to ? new Date(to) : new Date(),
    } : undefined;
    const perfMap = await batchGetStaffListPerformance(memberIds, perfRange);

    const { batchGetRunningStaffPaid } = await import('@/server/modules/staff');
    const { batchGetActiveFineTotals } = await import('@/server/modules/staff-fines');

    const period = (from || to) ? { from: from || undefined, to: to || undefined } : undefined;

    const [runningPaidMap, finesMap] = await Promise.all([
      batchGetRunningStaffPaid(memberIds, period),
      batchGetActiveFineTotals(memberIds, period)
    ]);

    const [incomeSummary, allStaffIds] = await Promise.all([
      prisma.staffIncome.aggregate({
        where: {
          staff: where,
          ...(period ? {
            createdAt: {
              ...(period.from ? { gte: new Date(period.from as string) } : {}),
              ...(period.to ? { lte: new Date(period.to as string) } : {}),
            }
          } : {})
        },
        _sum: { amount: true },
      }),
      prisma.staffMember.findMany({
        where,
        select: { id: true },
      }),
    ]);
    const totalEarnedTotal = Number(incomeSummary._sum.amount || 0);

    const allIds = allStaffIds.map(s => s.id);
    const [totalRunningPaidMap, totalFinesMap] = await Promise.all([
      batchGetRunningStaffPaid(allIds, period),
      batchGetActiveFineTotals(allIds, period)
    ]);

    const totalPaidSummary = Array.from(totalRunningPaidMap.values()).reduce((sum, val) => sum + val, 0);
    const totalFinesSummary = Array.from(totalFinesMap.values()).reduce((sum, val) => sum + val, 0);
    const totalDueSummary = Math.max(0, totalEarnedTotal - totalPaidSummary - totalFinesSummary);

    const inviteAsStaff = invites
      .filter((inv: any) => !inv.usedAt && inv.status === 'Pending' && !existingEmails.has(inv.email?.toLowerCase()))
      .filter((inv: any) => {
        if (dbRole && inv.role !== dbRole) return false;
        if (designationParam && designationParam !== 'all' && (inv as any).designation !== designationParam) return false;
        if (!search) return true;
        const query = search.toLowerCase();
        return (
          String(inv.email || '').toLowerCase().includes(query) ||
          String(inv.staffCode || '').toLowerCase().includes(query) ||
          String((inv as any).phone || '').toLowerCase().includes(query)
        );
      })
      .map((inv: any) => {
        const businessIds = Array.isArray(inv.businessIds) ? inv.businessIds : [];
        return {
          id: `invite_${inv.id}`,
          clerkId: '',
          staffCode: inv.staffCode || inv.id,
          name: inv.email,
          email: inv.email,
          phone: (inv as any).phone || '',
          role: dbToUiRole[inv.role] || inv.role as StaffRole,
          workType: 'Remote',
          accessibleBusinessIds: businessIds,
          accessibleBusinesses: businessIds.map((id: string) => ({ id, name: id })), // Approximation
          lastLogin: inv.createdAt?.toISOString?.() ?? new Date().toISOString(),
          createdAt: inv.createdAt?.toISOString?.() ?? new Date().toISOString(),
          paymentType: 'Both',
          salaryDetails: { amount: 0, frequency: 'Monthly' },
          commissionDetails: {},
          performance: {
            ordersCreated: 0,
            ordersConfirmed: 0,
            ordersWorked: 0,
            totalOrderActions: 0,
            incompleteWorked: 0,
            incompleteConverted: 0,
            incompleteConversionRate: 0,
            statusBreakdown: {},
            createdStatusBreakdown: {},
            confirmedStatusBreakdown: {},
          },
          financials: {
            totalEarned: 0,
            totalPaid: 0,
            totalFines: 0,
            dueAmount: 0,
          },
          paymentHistory: [],
          incomeHistory: [],
          permissions: attachPageAccess(inv.permissions || {}, 'Custom'),
        } as StaffMemberUI;
      });

    const mappedMembers = members.map((m) => {
      const isAdmin = m.role === 'Admin';
      const perf = perfMap.get(m.id);
      return mapStaff({
        ...m,
        accessibleBusinesses: isAdmin ? allBusinesses : m.accessibleBusinesses,
      }, avatarMap[m.clerkId], incomeMap[m.id] ?? 0, runningPaidMap.get(m.id) ?? 0, finesMap.get(m.id) ?? 0, perf ? {
        ordersCreated: perf.ordersCreated,
        ordersConfirmed: perf.ordersConfirmed,
        ordersWorked: perf.ordersWorked,
        totalOrderActions: perf.totalOrderActions,
        incompleteWorked: 0,
        incompleteConverted: 0,
        incompleteConversionRate: 0,
        statusBreakdown: perf.statusBreakdown,
        createdStatusBreakdown: {},
        confirmedStatusBreakdown: {},
      } : undefined);
    });

    return {
      items: [...mappedMembers, ...inviteAsStaff],
      total,
      page,
      pageSize,
      summary: {
        totalEarned: totalEarnedTotal,
        totalPaid: totalPaidSummary,
        totalFines: totalFinesSummary,
        totalDue: totalDueSummary,
      },
      uniqueDesignations,
    };
}
