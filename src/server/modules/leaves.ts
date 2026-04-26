import prisma from '@/lib/prisma';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { dateFromYmdUtc, formatDateYmdInTz } from '@/lib/date-utils';
import crypto from 'crypto';

// --- Leave Type CRUD ---

export async function listLeaveTypes(all = false) {
  const where = all ? {} : { isActive: true };
  return prisma.leaveType.findMany({ where, orderBy: { name: 'asc' } });
}

export async function createLeaveType(data: {
  name: string;
  isPaid?: boolean;
  annualAllocation?: number;
  maxCarryForward?: number;
}) {
  return prisma.leaveType.create({
    data: {
      name: data.name,
      isPaid: data.isPaid ?? true,
      annualAllocation: data.annualAllocation ?? 0,
      maxCarryForward: data.maxCarryForward ?? 0,
    },
  });
}

export async function updateLeaveType(id: string, data: Partial<{
  name: string;
  isPaid: boolean;
  annualAllocation: number;
  maxCarryForward: number;
  isActive: boolean;
}>) {
  return prisma.leaveType.update({ where: { id }, data });
}

// --- Leave Balance ---

export async function getLeaveBalances(staffId: string, year: number) {
  const types = await prisma.leaveType.findMany({ where: { isActive: true } });
  const balances = await prisma.leaveBalance.findMany({
    where: { staffId, year },
    include: { leaveType: true },
  });

  const balanceMap = new Map(balances.map((b) => [b.leaveTypeId, b]));

  return types.map((type) => {
    const bal = balanceMap.get(type.id);
    return {
      leaveTypeId: type.id,
      leaveTypeName: type.name,
      isPaid: type.isPaid,
      allocated: bal?.allocated ?? type.annualAllocation,
      used: bal?.used ?? 0,
      carried: bal?.carried ?? 0,
      remaining: (bal?.allocated ?? type.annualAllocation) + (bal?.carried ?? 0) - (bal?.used ?? 0),
    };
  });
}

export async function ensureLeaveBalance(staffId: string, leaveTypeId: string, year: number) {
  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type) throw new Error('Leave type not found');

  return prisma.leaveBalance.upsert({
    where: { staffId_leaveTypeId_year: { staffId, leaveTypeId, year } },
    create: {
      staffId,
      leaveTypeId,
      year,
      allocated: type.annualAllocation,
      used: 0,
      carried: 0,
    },
    update: {},
  });
}

// --- Leave Request ---

export async function submitLeaveRequest(staffId: string, data: {
  leaveTypeId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  days?: number; // Keep optional but compute server-side
  reason?: string;
}) {
  const settings = await getGeneralSettings();
  const tz = settings.timezone || 'Asia/Dhaka';

  // Validate leave type exists
  const leaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
  if (!leaveType || !leaveType.isActive) throw new Error('Leave type not found or inactive');

  const fromDate = dateFromYmdUtc(data.fromDate);
  const toDate = dateFromYmdUtc(data.toDate);
  
  if (toDate < fromDate) throw new Error('To date cannot be before from date');

  // Compute days from dates (inclusive)
  const computedDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Get/ensure balance for paid leave
  const year = fromDate.getFullYear();
  if (leaveType.isPaid) {
    const balance = await ensureLeaveBalance(staffId, data.leaveTypeId, year);
    const remaining = balance.allocated + balance.carried - balance.used;
    if (computedDays > remaining) {
      throw new Error(`Insufficient leave balance. Available: ${remaining}, Requested: ${computedDays}`);
    }
  }

  // Prevent overlapping leave requests
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      staffId,
      status: { notIn: ['Rejected', 'Cancelled'] },
      OR: [
        { fromDate: { lte: toDate }, toDate: { gte: fromDate } },
      ],
    },
  });
  if (overlap) {
    throw new Error('Overlapping leave request exists for the selected dates.');
  }

  const initialStatus = settings.allowAutoManagerApproval ? 'ManagerApproved' : 'Pending';

  return prisma.leaveRequest.create({
    data: {
      staffId,
      leaveTypeId: data.leaveTypeId,
      fromDate,
      toDate,
      days: computedDays,
      reason: data.reason,
      status: initialStatus as any,
      managerApprovedAt: settings.allowAutoManagerApproval ? new Date() : null,
    },
    include: { leaveType: true, staff: { select: { id: true, name: true } } },
  });
}

export async function approveLeaveRequest(requestId: string, approverId: string, approverRole: string) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { leaveType: true },
  });
  if (!request) throw new Error('Leave request not found');

  const isAdmin = approverRole.toLowerCase() === 'admin';
  const isManager = approverRole.toLowerCase().includes('manager') || isAdmin;

  if (request.status === 'Pending') {
    if (!isManager) throw new Error('Only managers can perform initial approval');
    return prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: 'ManagerApproved', managerApprovedAt: new Date() },
      include: { leaveType: true, staff: { select: { id: true, name: true } } },
    });
  }

  if (request.status === 'ManagerApproved') {
    if (!isAdmin) throw new Error('Only admins can perform final approval');

    // Final approval: update balance + mark attendance
    await prisma.$transaction(async (tx) => {
      const settings = await getGeneralSettings();
      const tz = settings.timezone || 'Asia/Dhaka';

      // Update balance
      if (request.leaveType.isPaid) {
        const year = request.fromDate.getFullYear();
        await tx.leaveBalance.upsert({
          where: {
            staffId_leaveTypeId_year: {
              staffId: request.staffId,
              leaveTypeId: request.leaveTypeId,
              year,
            },
          },
          create: {
            staffId: request.staffId,
            leaveTypeId: request.leaveTypeId,
            year,
            allocated: request.leaveType.annualAllocation,
            used: request.days,
            carried: 0,
          },
          update: { used: { increment: request.days } },
        });
      }

      // Mark attendance records as OnLeave for the date range
      // We iterate locally but calculate the correct dateKey for each day in TZ
      for (let i = 0; i < request.days; i++) {
        const nextDay = new Date(request.fromDate);
        nextDay.setUTCDate(request.fromDate.getUTCDate() + i);
        const ymd = nextDay.toISOString().split('T')[0];
        const dateKey = dateFromYmdUtc(ymd);

        await tx.attendanceRecord.upsert({
          where: {
            staffId_date: { staffId: request.staffId, date: dateKey },
          },
          create: {
            id: `attn_${crypto.randomBytes(12).toString('hex')}`,
            staffId: request.staffId,
            date: dateKey,
            status: 'OnLeave',
            leaveRequestId: requestId,
          },
          update: {
            status: 'OnLeave',
            leaveRequestId: requestId,
            checkInTime: null,
            checkOutTime: null,
            totalWorkDuration: null,
            totalBreakDuration: null,
          },
        });
      }

      // Final approval
      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'AdminApproved', adminApprovedAt: new Date() },
      });
    });

    return prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { leaveType: true, staff: { select: { id: true, name: true } } },
    });
  }

  throw new Error(`Cannot approve request in status: ${request.status}`);
}

export async function rejectLeaveRequest(requestId: string, rejectedBy: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Leave request not found');
  if (request.status === 'AdminApproved' || request.status === 'Rejected' || request.status === 'Cancelled') {
    throw new Error(`Cannot reject request in status: ${request.status}`);
  }

  return prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: 'Rejected', rejectedAt: new Date(), rejectedBy },
    include: { leaveType: true, staff: { select: { id: true, name: true } } },
  });
}

export async function cancelLeaveRequest(requestId: string, staffId: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Leave request not found');
  if (request.staffId !== staffId) throw new Error('Cannot cancel another staff member\'s request');
  if (request.status === 'AdminApproved') throw new Error('Cannot cancel an approved request');

  return prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: 'Cancelled' },
    include: { leaveType: true },
  });
}

export async function listLeaveRequests(params: {
  staffId?: string;
  status?: string;
  year?: number;
}) {
  const where: any = {};
  if (params.staffId) where.staffId = params.staffId;
  if (params.status) where.status = params.status;
  if (params.year) {
    const start = new Date(Date.UTC(params.year, 0, 1));
    const end = new Date(Date.UTC(params.year, 11, 31));
    where.fromDate = { gte: start, lte: end };
  }

  return prisma.leaveRequest.findMany({
    where,
    include: {
      leaveType: true,
      staff: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
