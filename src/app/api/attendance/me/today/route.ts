import { NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getTodayAttendanceForStaff } from '@/server/modules/attendance';

export async function GET() {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const record = await getTodayAttendanceForStaff(auth.staff.id);
    return NextResponse.json(record);
  } catch (error) {
    console.error('[API:ATTENDANCE_ME_TODAY]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

