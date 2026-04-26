import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { ensureDailyAttendanceRecords, getAttendanceRecords } from '@/server/modules/attendance';
import { getMonthRangeInStoreTz } from '@/lib/timezone';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { formatDateYmdInTz, dateFromYmdUtc } from '@/lib/date-utils';

// Removed local zonedDate helper, now using dateFromYmdUtc for AttendanceRecord.date (which is @db.Date)


const hasReadAccess = (permission: any): boolean => {
  if (!permission) return false;
  if (typeof permission === 'boolean') return permission;
  return Boolean(permission.read);
};

const normalizeRoleToken = (role?: string | null): string =>
  String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');

const isManagerClassRole = (role?: string | null): boolean =>
  normalizeRoleToken(role).includes('manager');

// Removed local parseDate helper


export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canReadAttendance = hasReadAccess(auth.staff?.permissions?.attendance);

    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');
    const staffIdParam = req.nextUrl.searchParams.get('staffId') || undefined;
    const monthParam = req.nextUrl.searchParams.get('month');
    const yearParam = req.nextUrl.searchParams.get('year');

    const cursor = req.nextUrl.searchParams.get('cursor') || undefined;
    const pageSize = Number(req.nextUrl.searchParams.get('pageSize')) || 50;
    const workType = req.nextUrl.searchParams.get('workType') || undefined;
    const status = req.nextUrl.searchParams.get('status') || undefined;
    const designation = req.nextUrl.searchParams.get('designation') || undefined;

    // Optional date range
    // AttendanceRecord.date is @db.Date, so we filter by date-only objects normalized to UTC
    let from: Date | undefined = fromParam ? dateFromYmdUtc(fromParam) : undefined;
    let to: Date | undefined = toParam ? dateFromYmdUtc(toParam) : undefined;
    const month = monthParam ? Number(monthParam) : NaN;
    const year = yearParam ? Number(yearParam) : NaN;

    // If month/year provided, override/set from/to
    if (Number.isFinite(month) && Number.isFinite(year)) {
      const range = await getMonthRangeInStoreTz(year, month);
      from = range.start;
      to = range.end;
    }

    // Manager-class roles can read staff histories (for staff profile/oversight pages).
    // Non-manager roles remain self-only.
    const role = auth.staff?.role as string | undefined;
    const isPrivileged = normalizeRoleToken(role) === 'admin' || isManagerClassRole(role);
    const effectiveStaffId = isPrivileged ? staffIdParam : auth.staff.id;

    if (!canReadAttendance) {
      if (staffIdParam && staffIdParam !== auth.staff.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (!isPrivileged && staffIdParam && staffIdParam !== auth.staff.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
      if (from && to) {
        const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 31) {
          const currentDate = new Date(from);
          const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';
          while (currentDate <= to) {
            await ensureDailyAttendanceRecords({ date: formatDateYmdInTz(currentDate, tz) });
            currentDate.setDate(currentDate.getDate() + 1);
          }
        } else {
          await ensureDailyAttendanceRecords();
        }
      } else {
        await ensureDailyAttendanceRecords();
      }
    } catch (e) {
      console.error('[API:ATTENDANCE_GET] Failed to ensure daily records:', e);
    }

    const { items, nextCursor, uniqueDesignations } = await getAttendanceRecords({
      from,
      to,
      staffId: effectiveStaffId,
      workType,
      status,
      designation,
      cursor,
      pageSize
    });

    return NextResponse.json({ items, nextCursor, uniqueDesignations });
  } catch (error) {
    console.error('[API:ATTENDANCE_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
