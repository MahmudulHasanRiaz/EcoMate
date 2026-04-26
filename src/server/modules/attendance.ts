import prisma from '@/lib/prisma';
import type { AttendanceRecord as AppAttendanceRecord, AttendanceStatus as AppAttendanceStatus, BreakRecord as AppBreakRecord, StaffRole } from '@/types';
import { differenceInMinutes } from 'date-fns';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { getEffectiveShift, shiftExpectedMinutes } from '@/server/modules/shifts';
import crypto from "crypto";

type DbStaffLite = {
  id: string;
  name: string;
  role: StaffRole;
  designation?: string | null;
  workType: string;
};

type DbAttendanceWithRelations = {
  id: string;
  staffId: string;
  date: Date;
  status: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  expectedMinutes?: number | null;
  totalWorkDuration: number | null;
  totalBreakDuration: number | null;
  totalInactiveDuration: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
  overtimeMinutes?: number | null;
  overtimeBonusAmount?: number | null;
  leaveRequest?: { leaveType?: { name?: string } } | null;
  staff?: DbStaffLite;
  breaks: { id: string; startTime: Date; endTime: Date | null }[];
  inactiveRecords: { id: string; startTime: Date; endTime: Date | null }[];
};

const toUiStatus = (status: string): AppAttendanceStatus => {
  if (status === 'OnLeave') return 'On Leave';
  if (status === 'Late') return 'Late';
  return status as AppAttendanceStatus;
};

const computeTotalBreakMinutes = (breaks: DbAttendanceWithRelations['breaks']) => {
  return (breaks || []).reduce((acc, br) => {
    if (!br.endTime) return acc;
    return acc + Math.max(0, differenceInMinutes(br.endTime, br.startTime));
  }, 0);
};

const computeTotalInactiveMinutes = (inactives: DbAttendanceWithRelations['inactiveRecords']) => {
  return (inactives || []).reduce((acc, br) => {
    if (!br.endTime) return acc;
    return acc + Math.max(0, differenceInMinutes(br.endTime, br.startTime));
  }, 0);
};

const computeTotalWorkMinutes = (rec: Pick<DbAttendanceWithRelations, 'checkInTime' | 'checkOutTime' | 'breaks' | 'inactiveRecords'>) => {
  if (!rec.checkInTime || !rec.checkOutTime) return null;
  const totalBreak = computeTotalBreakMinutes(rec.breaks);
  const totalInactive = computeTotalInactiveMinutes(rec.inactiveRecords);
  const total = differenceInMinutes(rec.checkOutTime, rec.checkInTime) - totalBreak - totalInactive;
  return total > 0 ? total : 0;
};

const toAppRecord = (rec: DbAttendanceWithRelations, staff?: DbStaffLite, shiftInfo?: { shiftStartTime?: string; lateGraceMinutes?: number }): AppAttendanceRecord => {
  const resolvedStaff = rec.staff || staff;
  const breaks: AppBreakRecord[] = (rec.breaks || []).map((b) => ({
    id: b.id,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime ? b.endTime.toISOString() : null,
  }));
  const inactiveRecords = (rec.inactiveRecords || []).map((b) => ({
    id: b.id,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime ? b.endTime.toISOString() : null,
  }));

  const computedTotalBreak = computeTotalBreakMinutes(rec.breaks || []);
  const computedTotalInactive = computeTotalInactiveMinutes(rec.inactiveRecords || []);
  const totalBreakDuration = rec.totalBreakDuration ?? computedTotalBreak;
  const totalInactiveDuration = rec.totalInactiveDuration ?? computedTotalInactive;
  const totalWorkDuration = rec.totalWorkDuration ?? computeTotalWorkMinutes(rec);

  // Map weekend/holiday OnLeave to "Off Day" for display
  const rawStatus = toUiStatus(rec.status);
  const displayStatus = (rawStatus === 'On Leave' && (rec.isWeekend || rec.isHoliday) && !rec.leaveRequest)
    ? 'Off Day' as any
    : rawStatus;

  return {
    id: rec.id,
    staffId: rec.staffId,
    staffName: resolvedStaff?.name || 'Unknown',
    staffRole: (resolvedStaff?.role as StaffRole) || ('Custom' as StaffRole),
    staffAvatar: '',
    staffWorkType: (resolvedStaff?.workType as any) || 'Remote',
    staffDesignation: resolvedStaff?.designation || null,
    date: rec.date.toISOString(),
    status: displayStatus,
    checkInTime: rec.checkInTime ? rec.checkInTime.toISOString() : null,
    checkOutTime: rec.checkOutTime ? rec.checkOutTime.toISOString() : null,
    totalWorkDuration,
    totalBreakDuration,
    totalInactiveDuration,
    breaks,
    inactiveRecords,
    isHoliday: rec.isHoliday ?? false,
    isWeekend: rec.isWeekend ?? false,
    expectedMinutes: rec.expectedMinutes ?? 0,
    overtimeMinutes: rec.overtimeMinutes ?? null,
    overtimeBonusAmount: rec.overtimeBonusAmount ?? 0,
    leaveType: rec.leaveRequest?.leaveType?.name,
    shiftStartTime: shiftInfo?.shiftStartTime ?? null,
    lateGraceMinutes: shiftInfo?.lateGraceMinutes ?? null,
  };
};

const normalizeDateOnly = (d: Date) => {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};


const formatDateYmdInTz = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const parseTimeToMinutes = (value: string | null | undefined, fallbackMinutes: number) => {
  if (!value) return fallbackMinutes;
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackMinutes;
  const total = h * 60 + m;
  if (total < 0 || total >= 24 * 60) return fallbackMinutes;
  return total;
};

const getNowMinutesInTz = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
};

const isValidDateString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const zonedDate = (ymd: string, tz: string, time = '00:00:00') => {
  let d = ymd;
  if (d.includes('T')) d = d.split('T')[0];
  const guess = new Date(`${d}T${time}Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;
  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');
  return new Date(`${d}T${time}${offset}`);
};

const endOfDayInTz = (ymd: string, tz: string) => zonedDate(ymd, tz, '23:59:59');
const dateFromYmdUtc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const dateFromYmd = dateFromYmdUtc;

const weekdayFromYmd = (value: string) => dateFromYmd(value).getUTCDay();

const normalizeWeekendDays = (value: unknown, fallback: number[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => (typeof item === 'string' ? Number(item) : item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  return Array.from(new Set(normalized));
};

const normalizeHolidayList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  return Array.from(new Set(normalized));
};

const getAttendanceCalendarSettings = async () => {
  const settings = await getGeneralSettings();
  return {
    timezone: settings.timezone || 'Asia/Dhaka',
    weekendDays: normalizeWeekendDays(settings.weekendDays, [5, 6]),
    holidays: normalizeHolidayList(settings.holidays, []),
    lateGraceMinutes: settings.lateGraceMinutes ?? 0,
    workStartTime: settings.workStartTime ?? '09:00',
  };
};

const clampRange = (from: Date, to: Date, maxDaysInclusive = 62) => {
  const start = normalizeDateOnly(from);
  const end = normalizeDateOnly(to);
  if (end < start) return { start: end, end: start };

  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= maxDaysInclusive) return { start, end };

  const clampedEnd = new Date(start);
  clampedEnd.setDate(clampedEnd.getDate() + maxDaysInclusive);
  return { start, end: clampedEnd };
};

export async function getAttendanceRecords(params: { 
  from?: Date; 
  to?: Date; 
  staffId?: string; 
  workType?: string; 
  status?: string;
  designation?: string;
  cursor?: string; 
  pageSize?: number 
}): Promise<{ items: AppAttendanceRecord[]; nextCursor: string | null; uniqueDesignations: string[] }> {
  const { from, to, staffId, workType, status, designation, cursor, pageSize: ps } = params;
  const pageSize = Math.min(ps && ps > 0 ? ps : 50, 2000);

  const where: any = {};
  if (staffId) where.staffId = staffId;
  
  if (workType && workType !== 'all') {
    where.staff = where.staff || {};
    where.staff.workType = workType;
  }
  if (designation && designation !== 'all') {
    where.staff = where.staff || {};
    where.staff.designation = designation;
  }

  if (status && status !== 'all') {
    // Map UI "On Leave" to DB "OnLeave"
    where.status = status === 'On Leave' ? 'OnLeave' : status;
  }


  if (from || to) {
    const { start, end } = clampRange(from || new Date(), to || new Date());
    where.date = { gte: start, lte: end };
  }

  const rawItems = await prisma.attendanceRecord.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
    include: { staff: { select: { id: true, name: true, role: true, designation: true, workType: true } }, breaks: true, inactiveRecords: true, leaveRequest: { select: { leaveType: { select: { name: true } } } } },
  });

  const hasMore = rawItems.length > pageSize;
  const items = hasMore ? rawItems.slice(0, pageSize) : rawItems;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  // Resolve shift info per staff for dynamic status computation on the client
  const { workStartTime, lateGraceMinutes: globalGrace } = await getAttendanceCalendarSettings();
  const staffIds = [...new Set(items.map((r: any) => r.staffId))];
  const overrides = await prisma.staffShiftOverride.findMany({
    where: { staffId: { in: staffIds }, isActive: true },
    select: { staffId: true, startTime: true, lateGraceMinutes: true },
  });
  const templates = await prisma.shiftTemplate.findMany({
    where: { isActive: true },
    select: { role: true, startTime: true, lateGraceMinutes: true },
  });
  const overrideMap = new Map(overrides.map(o => [o.staffId, o]));
  const globalTemplate = templates.find(t => !t.role || String(t.role).trim() === '');
  const templateByRole = new Map<string, any>();
  for (const t of templates) { if (t.role) templateByRole.set(String(t.role), t); }

  const resolveShiftForStaff = (staffId: string, role?: string) => {
    const o = overrideMap.get(staffId);
    if (o) return { shiftStartTime: o.startTime || workStartTime, lateGraceMinutes: o.lateGraceMinutes ?? globalGrace };
    const t = templateByRole.get(String(role || '')) || globalTemplate;
    return { shiftStartTime: t?.startTime || workStartTime, lateGraceMinutes: t?.lateGraceMinutes ?? globalGrace };
  };

  const uniqueDesignationsRaw = await prisma.staffMember.findMany({
    select: { designation: true },
    distinct: ['designation'],
  });
  const uniqueDesignations = uniqueDesignationsRaw.map(d => d.designation).filter(Boolean).sort() as string[];

  return {
    items: items.map((rec: any) => {
      const shiftInfo = resolveShiftForStaff(rec.staffId, rec.staff?.role);
      return toAppRecord(rec, rec.staff, shiftInfo);
    }),
    nextCursor,
    uniqueDesignations,
  };
}

export async function getTodayAttendanceForStaff(staffId: string): Promise<AppAttendanceRecord | null> {
  const { timezone } = await getAttendanceCalendarSettings();
  const todayYmd = formatDateYmdInTz(new Date(), timezone);
  const todayKey = dateFromYmdUtc(todayYmd);
  const rec = (await prisma.attendanceRecord.findUnique({
    where: { staffId_date: { staffId, date: todayKey } },
    include: { staff: { select: { id: true, name: true, role: true, designation: true, workType: true } }, breaks: true, inactiveRecords: true, leaveRequest: { select: { leaveType: { select: { name: true } } } } },
  })) as any as DbAttendanceWithRelations | null;

  if (!rec) return null;
  return toAppRecord(rec);
}


export async function clockInStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  const { timezone, weekendDays: globalWeekendDays, holidays, lateGraceMinutes, workStartTime } = await getAttendanceCalendarSettings();

  const todayYmd = formatDateYmdInTz(now, timezone);
  const todayKey = dateFromYmdUtc(todayYmd);

  await prisma.$transaction(async (tx) => {
    // Stale session cleanup
    const openSession = await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { breaks: true, inactiveRecords: true },
    });

    if (openSession) {
      const openDateStr = formatDateYmdInTz(openSession.date, timezone);
      if (openDateStr !== todayYmd) {
        const staleEnd = endOfDayInTz(openDateStr, timezone);
        
        const openBreaks = openSession.breaks.filter((b: any) => !b.endTime);
        for (const br of openBreaks) {
          await tx.breakRecord.update({ where: { id: br.id }, data: { endTime: staleEnd } });
        }
        
        const openInactives = openSession.inactiveRecords.filter((b: any) => !b.endTime);
        for (const ir of openInactives) {
          await tx.attendanceInactiveRecord.update({ where: { id: ir.id }, data: { endTime: staleEnd } });
        }
        
        const mergedBreaks = openSession.breaks.map((b: any) => (!b.endTime ? { ...b, endTime: staleEnd } : b));
        const mergedInactives = openSession.inactiveRecords.map((b: any) => (!b.endTime ? { ...b, endTime: staleEnd } : b));

        const totalBreak = computeTotalBreakMinutes(mergedBreaks as any);
        const totalInactive = computeTotalInactiveMinutes(mergedInactives as any);
        const totalWork = openSession.checkInTime
          ? differenceInMinutes(staleEnd, openSession.checkInTime) - totalBreak - totalInactive
          : 0;

        await tx.attendanceRecord.update({
          where: { id: openSession.id },
          data: {
            checkOutTime: staleEnd,
            totalBreakDuration: totalBreak,
            totalInactiveDuration: totalInactive,
            totalWorkDuration: totalWork > 0 ? totalWork : 0,
          },
        });
      } else if (openSession.checkInTime) {
        return;
      }
    }

    const todayRecord = await tx.attendanceRecord.findUnique({
      where: { staffId_date: { staffId, date: todayKey } },
      include: { breaks: true },
    });

    if (todayRecord?.checkOutTime) {
      const likelyAutoRecord =
        !todayRecord.checkInTime ||
        todayRecord.status === 'Absent' ||
        todayRecord.status === 'OnLeave' ||
        todayRecord.totalWorkDuration == null;

      if (likelyAutoRecord) {
        await tx.attendanceRecord.update({
          where: { id: todayRecord.id },
          data: {
            checkOutTime: null,
            totalWorkDuration: null,
            totalBreakDuration: null,
            totalInactiveDuration: null,
          },
        });
      } else {
        throw new Error('Already clocked out for today.');
      }
    }
    const staffInfoRaw = await tx.staffMember.findUnique({ where: { id: staffId }, select: { role: true, weekendDays: true } });
    const { weekendDays: globalWeekendDays, holidays } = await getAttendanceCalendarSettings();
    const isWeekend = normalizeWeekendDays(staffInfoRaw?.weekendDays, globalWeekendDays).includes(weekdayFromYmd(todayYmd));
    const isHoliday = holidays.includes(todayYmd);

    const effectiveShift = await getEffectiveShift(staffId, staffInfoRaw?.role as string);
    let status: 'Present' | 'Late' = 'Present';
    {
      const [startHour, startMin] = effectiveShift.startTime.split(':').map(Number);
      const grace = effectiveShift.lateGraceMinutes;
      if (Number.isFinite(startHour) && Number.isFinite(startMin)) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric', minute: 'numeric', hour12: false,
        }).formatToParts(now);
        const nowHour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
        const nowMin = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
        const nowTotalMin = nowHour * 60 + nowMin;
        const startTotalMin = startHour * 60 + startMin + grace;
        if (nowTotalMin > startTotalMin) {
          status = 'Late';
        }
      }
    }

    const expectedMinutes = shiftExpectedMinutes(effectiveShift);

    if (todayRecord) {
      await tx.attendanceRecord.update({
        where: { id: todayRecord.id },
        data: {
          status,
          checkInTime: now,
          checkOutTime: null,
          totalWorkDuration: null,
          totalBreakDuration: null,
          totalInactiveDuration: null,
          isWeekend,
          isHoliday,
          expectedMinutes,
        },
      });
    } else {
      await tx.attendanceRecord.create({
        data: {
          id: `attn_${crypto.randomBytes(12).toString('hex')}`,
          staffId,
          date: todayKey,
          status,
          checkInTime: now,
          isWeekend,
          isHoliday,
          expectedMinutes,
        },
      });
    }
  });

  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to clock in.');
  return fresh;
}

export async function startBreakForStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { breaks: true },
    });
    if (!rec || !rec.checkInTime) throw new Error('You must clock in first.');
    if (rec.checkOutTime) throw new Error('Already clocked out.');

    const hasOpenBreak = rec.breaks.some((b) => !b.endTime);
    if (hasOpenBreak) throw new Error('Break already started.');

    await tx.breakRecord.create({
      data: {
        id: `brk_${crypto.randomBytes(12).toString('hex')}`,
        attendanceId: rec.id,
        startTime: now,
      },
    });
  });

  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to start break.');
  return fresh;
}

export async function endBreakForStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { breaks: true },
    });

    if (!rec || !rec.checkInTime) throw new Error('You must clock in first.');
    if (rec.checkOutTime) throw new Error('Already clocked out.');

    const openBreak = [...rec.breaks].sort((a, b) => b.startTime.getTime() - a.startTime.getTime()).find((b) => !b.endTime);
    if (!openBreak) throw new Error('No active break found.');

    await tx.breakRecord.update({
      where: { id: openBreak.id },
      data: {
        endTime: now,
      },
    });

    const updatedBreaks = rec.breaks.map((b) => (b.id === openBreak.id ? { ...b, endTime: now } : b));
    const totalBreak = computeTotalBreakMinutes(updatedBreaks as any);
    await tx.attendanceRecord.update({
      where: { id: rec.id },
      data: {
        totalBreakDuration: totalBreak,
      },
    });
  });

  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to end break.');
  return fresh;
}

export async function startInactiveForStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { inactiveRecords: true },
    });
    if (!rec || !rec.checkInTime) throw new Error('You must clock in first.');
    const hasOpen = rec.inactiveRecords.some((b) => !b.endTime);
    if (hasOpen) return; 

    await tx.attendanceInactiveRecord.create({
      data: {
        id: `inac_${crypto.randomBytes(12).toString('hex')}`,
        attendanceId: rec.id,
        startTime: now,
      },
    });
  });
  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to start inactive.');
  return fresh;
}

export async function endInactiveForStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { inactiveRecords: true },
    });
    if (!rec || !rec.checkInTime) throw new Error('You must clock in first.');
    const open = rec.inactiveRecords.find((b) => !b.endTime);
    if (!open) return;

    await tx.attendanceInactiveRecord.update({
      where: { id: open.id },
      data: { endTime: now },
    });

    const updated = rec.inactiveRecords.map((b) => (b.id === open.id ? { ...b, endTime: now } : b));
    const totalInactive = computeTotalInactiveMinutes(updated as any);
    await tx.attendanceRecord.update({
      where: { id: rec.id },
      data: { totalInactiveDuration: totalInactive },
    });
  });
  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to end inactive.');
  return fresh;
}

export async function clockOutStaff(staffId: string): Promise<AppAttendanceRecord> {
  const now = new Date();
  const { timezone: tz } = await getAttendanceCalendarSettings();

  await prisma.$transaction(async (tx) => {
    const rec = (await tx.attendanceRecord.findFirst({
      where: { staffId, checkOutTime: null, checkInTime: { not: null } },
      orderBy: { date: 'desc' },
      include: { breaks: true, inactiveRecords: true },
    })) as any as DbAttendanceWithRelations | null;

    if (!rec || !rec.checkInTime) throw new Error('You must clock in first.');

    const checkInDateYmd = formatDateYmdInTz(rec.checkInTime, tz);
    let effectiveCheckout = now;
    if (checkInDateYmd !== formatDateYmdInTz(now, tz)) {
      effectiveCheckout = endOfDayInTz(checkInDateYmd, tz);
    }

    for (const br of rec.breaks.filter((b) => !b.endTime)) {
      await tx.breakRecord.update({ where: { id: br.id }, data: { endTime: effectiveCheckout } });
    }
    for (const br of rec.inactiveRecords.filter((b) => !b.endTime)) {
      await tx.attendanceInactiveRecord.update({ where: { id: br.id }, data: { endTime: effectiveCheckout } });
    }

    const mergedBreaks = rec.breaks.map((b) => (!b.endTime ? { ...b, endTime: effectiveCheckout } : b));
    const mergedInactives = rec.inactiveRecords.map((b) => (!b.endTime ? { ...b, endTime: effectiveCheckout } : b));
    
    const totalBreak = computeTotalBreakMinutes(mergedBreaks as any);
    const totalInactive = computeTotalInactiveMinutes(mergedInactives as any);
    
    const durationFromCheckIn = differenceInMinutes(effectiveCheckout, rec.checkInTime);
    const actualWork = Math.max(0, durationFromCheckIn - totalBreak - totalInactive);

    const staffInfo = await tx.staffMember.findUnique({ 
      where: { id: staffId }, 
      select: { role: true, salaryDetails: true, overtimeEligible: true, overtimeBonusPercent: true } 
    });
    const effectiveShift = await getEffectiveShift(staffId, staffInfo?.role as string);
    const expectedMinutes = shiftExpectedMinutes(effectiveShift);
    const overtimeCap = 120; // 2 hour cap
    const overtimeMinutes = Math.min(overtimeCap, Math.max(0, actualWork - expectedMinutes));
    let overtimeBonusAmount = 0;

    if (overtimeMinutes > 0 && staffInfo?.overtimeEligible) {
      const salaryDetails = staffInfo.salaryDetails as any;
      const baseAmount = Number(salaryDetails?.amount ?? 0);
      const frequency = salaryDetails?.frequency as string;
      if (baseAmount > 0 && frequency && expectedMinutes > 0) {
        const todayKey = dateFromYmdUtc(checkInDateYmd);
        let dayRate = 0;
        if (frequency === 'Monthly') {
          const dim = new Date(todayKey.getFullYear(), todayKey.getMonth() + 1, 0).getDate();
          dayRate = baseAmount / dim;
        } else if (frequency === 'Weekly') {
          dayRate = baseAmount / 7;
        } else if (frequency === 'Daily') {
          dayRate = baseAmount;
        }

        if (dayRate > 0) {
          const extraPercent = (staffInfo.overtimeBonusPercent || 0) / 100;
          overtimeBonusAmount = Math.round((dayRate / expectedMinutes) * overtimeMinutes * (1 + extraPercent) * 100) / 100;
          const otText = `Overtime ${overtimeMinutes}m (Work:${actualWork}m, Expected:${expectedMinutes}m). Base rate per min + ${staffInfo.overtimeBonusPercent}% extra.`;
          await tx.staffIncome.upsert({
            where: { staffId_action_referenceDate: { staffId, action: 'OvertimeBonus', referenceDate: todayKey } },
            create: { staffId, action: 'OvertimeBonus', amount: overtimeBonusAmount, referenceDate: todayKey, notes: otText },
            update: { amount: overtimeBonusAmount, notes: otText },
          });
        }
      }
    }

    await tx.attendanceRecord.update({
      where: { id: rec.id },
      data: {
        status: rec.status === 'Late' ? 'Late' : 'Present',
        checkOutTime: effectiveCheckout,
        totalBreakDuration: totalBreak,
        totalInactiveDuration: totalInactive,
        totalWorkDuration: actualWork,
        expectedMinutes,
        overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : null,
        overtimeBonusAmount,
      },
    });
  });

  const fresh = await getTodayAttendanceForStaff(staffId);
  if (!fresh) throw new Error('Failed to clock out.');
  return fresh;
}


export async function ensureDailyAttendanceRecords(params?: { date?: string }) {
  const { timezone, weekendDays: globalWeekendDays, holidays, lateGraceMinutes, workStartTime } = await getAttendanceCalendarSettings();
  const targetDate = params?.date ? params.date.trim() : formatDateYmdInTz(new Date(), timezone);
  const todayYmd = formatDateYmdInTz(new Date(), timezone);

  if (!isValidDateString(targetDate)) throw new Error('Invalid date. Expected format YYYY-MM-DD.');

  const weekday = weekdayFromYmd(targetDate);
  const isHoliday = holidays.includes(targetDate);
  const isToday = targetDate === todayYmd;
  const isFuture = targetDate > todayYmd;

  const staff = await prisma.staffMember.findMany({ select: { id: true, weekendDays: true, role: true } });
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) return { date: targetDate, created: 0, existing: 0, staffTotal: 0 };

  const dateKey = dateFromYmdUtc(targetDate);
  const existing = await prisma.attendanceRecord.findMany({ where: { date: dateKey }, select: { staffId: true } });
  const existingIds = new Set(existing.map((rec) => rec.staffId));
  const missingStaff = staff.filter((s) => !existingIds.has(s.id));

  if (isFuture) return { date: targetDate, created: 0, existing: existingIds.size, staffTotal: staffIds.length };

  const overrideByStaff = new Map<string, any>();
  const templates = await prisma.shiftTemplate.findMany({
    where: { isActive: true },
    select: { role: true, startTime: true, lateGraceMinutes: true, endTime: true, earlyLeaveGraceMinutes: true },
  });

  const globalTemplate = templates.find(t => !t.role || String(t.role).trim() === '');
  const templateByRole = new Map<string, any>();
  for (const t of templates) {
    if (t.role) templateByRole.set(String(t.role), t);
  }

  const overrides = await prisma.staffShiftOverride.findMany({ 
    where: { staffId: { in: staffIds }, isActive: true }, 
    select: { staffId: true, startTime: true, lateGraceMinutes: true, endTime: true, earlyLeaveGraceMinutes: true } 
  });
  for (const o of overrides) overrideByStaff.set(o.staffId, o as any);

  const nowMinutes = isToday ? getNowMinutesInTz(timezone) : 0;
  const globalStartMinutes = parseTimeToMinutes(workStartTime, 9 * 60);
  const globalGrace = Number.isFinite(lateGraceMinutes) ? lateGraceMinutes : 0;

  const createRows = missingStaff.flatMap((s) => {
    const staffIsWeekend = normalizeWeekendDays(s.weekendDays, globalWeekendDays).includes(weekday);
    const status = isHoliday || staffIsWeekend ? 'OnLeave' : 'Absent';
    
    const o = overrideByStaff.get(s.id);
    const t = o ? null : templateByRole.get(String(s.role || '')) || globalTemplate;
    
    // Resolve shift details for this staff member
    const shiftData: any = {
      startTime: o?.startTime || t?.startTime || workStartTime,
      endTime: (o as any)?.endTime || (t as any)?.endTime || "17:00",
      lateGraceMinutes: o?.lateGraceMinutes ?? t?.lateGraceMinutes ?? globalGrace,
      earlyLeaveGraceMinutes: (o as any)?.earlyLeaveGraceMinutes ?? (t as any)?.earlyLeaveGraceMinutes ?? 0,
      source: o ? 'override' : t ? 'template' : 'global',
    };
    const calculatedExpected = shiftExpectedMinutes(shiftData);

    // Records are always created for all staff so the dashboard shows everyone

    return [{ 
      id: `attn_${crypto.randomBytes(12).toString('hex')}`, 
      staffId: s.id, 
      date: dateKey, 
      status: status as any, 
      isWeekend: staffIsWeekend, 
      isHoliday,
      expectedMinutes: status === 'OnLeave' ? 0 : calculatedExpected 
    }];
  });

  if (createRows.length > 0) await prisma.attendanceRecord.createMany({ data: createRows, skipDuplicates: true });

  const existingWithNullExpected = await prisma.attendanceRecord.findMany({
    where: { date: dateKey, expectedMinutes: null },
    select: { id: true, staffId: true, status: true, isWeekend: true, isHoliday: true }
  });

  for (const rec of existingWithNullExpected) {
    const staffInfo = staff.find(s => s.id === rec.staffId);
    if (!staffInfo) continue;

    const o = overrideByStaff.get(rec.staffId);
    const t = o ? null : templateByRole.get(String(staffInfo.role || '')) || globalTemplate;

    const shiftData: any = {
      startTime: o?.startTime || t?.startTime || workStartTime,
      endTime: o?.endTime || t?.endTime || "17:00",
      lateGraceMinutes: o?.lateGraceMinutes ?? t?.lateGraceMinutes ?? globalGrace,
      earlyLeaveGraceMinutes: o?.earlyLeaveGraceMinutes ?? t?.earlyLeaveGraceMinutes ?? 0,
      source: o ? 'override' : t ? 'template' : 'global',
    };

    const calculatedExpected = shiftExpectedMinutes(shiftData);
    const expected = rec.status === 'OnLeave' ? 0 : calculatedExpected;

    await prisma.attendanceRecord.update({
      where: { id: rec.id },
      data: { expectedMinutes: expected },
    });
  }

  return { date: targetDate, created: createRows.length, existing: existingIds.size, staffTotal: staffIds.length };
}

export async function getAttendanceSummary(params: { from: Date; to: Date; staffId?: string }) {
  const { start, end } = clampRange(params.from, params.to);
  const where: any = { date: { gte: start, lte: end } };
  if (params.staffId) where.staffId = params.staffId;
  const [totalRecords, presentCount, lateCount, onLeaveCount, distinctStaff] = await Promise.all([
    prisma.attendanceRecord.count({ where }),
    prisma.attendanceRecord.count({ where: { ...where, status: 'Present' } }),
    prisma.attendanceRecord.count({ where: { ...where, status: 'Late' } }),
    prisma.attendanceRecord.count({ where: { ...where, status: 'OnLeave' } }),
    prisma.attendanceRecord.groupBy({ by: ['staffId'], where }),
  ]);
  return { totalRecords, presentCount, lateCount, onLeaveCount, activeStaffCount: distinctStaff.length };
}

export async function editAttendanceRecord(params: {
  attendanceId: string;
  editedById: string;
  reason: string;
  newCheckIn?: Date | null;
  newCheckOut?: Date | null;
  newStatus?: string | null;
  newInactiveDuration?: number | null;
  newOvertimeMinutes?: number | null;
}) {
  const rec = await prisma.attendanceRecord.findUnique({ where: { id: params.attendanceId }, include: { breaks: true } });
  if (!rec) throw new Error('Attendance record not found');
  const updateData: any = {};
  if (params.newCheckIn !== undefined) updateData.checkInTime = params.newCheckIn;
  if (params.newCheckOut !== undefined) updateData.checkOutTime = params.newCheckOut;
  if (params.newStatus) updateData.status = params.newStatus;
  if (params.newInactiveDuration !== undefined) updateData.totalInactiveDuration = params.newInactiveDuration;
  if (params.newOvertimeMinutes !== undefined) updateData.overtimeMinutes = params.newOvertimeMinutes;

  const staff = await prisma.staffMember.findUnique({ 
    where: { id: rec.staffId }, 
    select: { id: true, role: true, salaryDetails: true, overtimeEligible: true, overtimeBonusPercent: true } 
  });
  const { timezone: tz } = await getAttendanceCalendarSettings();
  const dateYmd = formatDateYmdInTz(rec.date, tz);
  const dateKey = dateFromYmdUtc(dateYmd);

  const effectiveCheckIn = params.newCheckIn !== undefined ? params.newCheckIn : rec.checkInTime;
  const effectiveCheckOut = params.newCheckOut !== undefined ? params.newCheckOut : rec.checkOutTime;
  if (effectiveCheckIn && effectiveCheckOut) {
    const totalBreak = computeTotalBreakMinutes(rec.breaks as any);
    const totalInactive = params.newInactiveDuration !== undefined ? (params.newInactiveDuration || 0) : (rec.totalInactiveDuration || 0);
    const totalWork = differenceInMinutes(effectiveCheckOut, effectiveCheckIn) - totalBreak - totalInactive;
    updateData.totalWorkDuration = Math.max(0, totalWork);
    updateData.totalBreakDuration = totalBreak;
    updateData.totalInactiveDuration = totalInactive;

    const effectiveShift = await getEffectiveShift(staff!.id, staff?.role as string);
    const expectedMinutes = shiftExpectedMinutes(effectiveShift);
    updateData.expectedMinutes = expectedMinutes;

    const overtimeCap = 120; // 2 hour cap
    const calculatedOvertime = Math.min(overtimeCap, Math.max(0, totalWork - expectedMinutes));
    const overtimeMinutes = (params.newOvertimeMinutes !== undefined ? params.newOvertimeMinutes : calculatedOvertime) || 0;
    updateData.overtimeMinutes = overtimeMinutes > 0 ? overtimeMinutes : null;

    if (overtimeMinutes > 0 && staff?.overtimeEligible) {
      const salaryDetails = staff.salaryDetails as any;
      const baseAmount = Number(salaryDetails?.amount ?? 0);
      const frequency = salaryDetails?.frequency as string;
      if (baseAmount > 0 && frequency && expectedMinutes > 0) {
        let dayRate = 0;
        if (frequency === 'Monthly') {
          const dim = new Date(dateKey.getFullYear(), dateKey.getMonth() + 1, 0).getDate();
          dayRate = baseAmount / dim;
        } else if (frequency === 'Weekly') {
          dayRate = baseAmount / 7;
        } else if (frequency === 'Daily') {
          dayRate = baseAmount;
        }

        if (dayRate > 0) {
          const extraPercent = (staff.overtimeBonusPercent || 0) / 100;
          const overtimeBonusAmount = Math.round((dayRate / expectedMinutes) * overtimeMinutes * (1 + extraPercent) * 100) / 100;
          updateData.overtimeBonusAmount = overtimeBonusAmount;
        }
      }
    } else {
      updateData.overtimeBonusAmount = 0;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendanceEditLog.create({
      data: {
        attendanceId: params.attendanceId,
        editedById: params.editedById,
        reason: params.reason,
        oldCheckIn: rec.checkInTime,
        newCheckIn: params.newCheckIn ?? null,
        oldCheckOut: rec.checkOutTime,
        newCheckOut: params.newCheckOut ?? null,
        oldStatus: rec.status,
        newStatus: params.newStatus ?? null,
        oldInactiveDuration: rec.totalInactiveDuration,
        newInactiveDuration: params.newInactiveDuration ?? null,
        oldOvertimeMinutes: rec.overtimeMinutes,
        newOvertimeMinutes: params.newOvertimeMinutes ?? null,
      },
    });

    if (updateData.overtimeBonusAmount !== undefined) {
      const otText = `Manual Edit. Overtime ${updateData.overtimeMinutes || 0}m.`;
      if (updateData.overtimeBonusAmount > 0) {
        await tx.staffIncome.upsert({
          where: { staffId_action_referenceDate: { staffId: rec.staffId, action: 'OvertimeBonus', referenceDate: dateKey } },
          create: { staffId: rec.staffId, action: 'OvertimeBonus', amount: updateData.overtimeBonusAmount, referenceDate: dateKey, notes: otText },
          update: { amount: updateData.overtimeBonusAmount, notes: otText },
        });
      } else {
        await tx.staffIncome.deleteMany({
          where: { staffId: rec.staffId, action: 'OvertimeBonus', referenceDate: dateKey }
        });
      }
    }

    await tx.attendanceRecord.update({ where: { id: params.attendanceId }, data: updateData });
  });

  return prisma.attendanceRecord.findUnique({
    where: { id: params.attendanceId },
    include: { staff: { select: { id: true, name: true, role: true } }, breaks: true, editLogs: { orderBy: { createdAt: 'desc' } } },
  });
}

export async function getAttendanceEditLogs(attendanceId: string) {
  return prisma.attendanceEditLog.findMany({
    where: { attendanceId },
    include: { editedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listWeekendWorkDays(staffId: string, year: number, month: number) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  return prisma.attendanceRecord.findMany({
    where: { staffId, isWeekend: true, status: { in: ['Present', 'Late'] }, checkInTime: { not: null }, date: { gte: firstDay, lte: lastDay } },
    select: { id: true, date: true, status: true },
    orderBy: { date: 'asc' },
  });
}
