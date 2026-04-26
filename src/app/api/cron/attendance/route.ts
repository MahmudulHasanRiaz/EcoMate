import { NextRequest, NextResponse } from 'next/server';
import { ensureDailyAttendanceRecords } from '@/server/modules/attendance';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.WOO_WEBHOOK_SECRET || '';
  if (secret) {
    const header = req.headers.get('x-cron-secret') || '';
    if (header !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await ensureDailyAttendanceRecords();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[ATTENDANCE_CRON_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Attendance cron failed' }, { status: 500 });
  }
}
