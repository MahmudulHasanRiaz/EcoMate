import { NextRequest, NextResponse } from 'next/server';
import { ensureDailyAttendanceRecords } from '@/server/modules/attendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[CRON_ERROR] CRON_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Configuration error' }, { status: 500 });
  }

  const header = req.headers.get('x-cron-secret');
  if (header !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const date = req.nextUrl.searchParams.get('date') || undefined;
    const result = await ensureDailyAttendanceRecords({ date: date || undefined });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[ATTENDANCE_DAILY_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Attendance daily job failed' }, { status: 500 });
  }
}
