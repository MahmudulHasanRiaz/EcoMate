import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getAttendanceSummary } from '@/server/modules/attendance';
import { getGeneralSettings } from '@/server/utils/app-settings';

const zonedDate = (ymd: string, tz: string, time = '00:00:00') => {
  if (ymd.includes('T')) ymd = ymd.split('T')[0];
  const guess = new Date(`${ymd}T${time}Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;
  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');
  return new Date(`${ymd}T${time}${offset}`);
};

function startOfMonthInTz(tz: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  return zonedDate(`${y}-${m}-01`, tz);
}

import { getReportCache } from '@/server/utils/report-cache';
import { enforcePermission } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status === 'blocked') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { allowed, staff } = await enforcePermission('attendance', 'read');
        if (!allowed || !staff) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const staffIdParam = searchParams.get('staffId') || undefined;

        const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';
        const from = fromStr ? zonedDate(fromStr, tz) : startOfMonthInTz(tz); // Default to 1st of month
        const to = toStr ? zonedDate(toStr, tz, '23:59:59') : new Date();

        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
        }

        const isManagerClass = staff.role.toLowerCase().includes('manager') || staff.role.toLowerCase() === 'admin';
        const effectiveStaffIdParam = isManagerClass ? (staffIdParam || undefined) : staff.id;

        const staffId = staff.id;
        const key = `report:attendance:summary:${staffId}:${from.toISOString()}:${to.toISOString()}:${effectiveStaffIdParam || 'all'}`;

        const summary = await getReportCache(key, () => getAttendanceSummary({ from, to, staffId: effectiveStaffIdParam }));
        return NextResponse.json(summary);
    } catch (error) {
        console.error('[API_ERROR:ATTENDANCE_SUMMARY]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
