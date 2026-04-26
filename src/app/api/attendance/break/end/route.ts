import { NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { endBreakForStaff } from '@/server/modules/attendance';

export async function POST(req: Request) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const requestedStaffId = typeof body?.staffId === 'string' ? body.staffId : undefined;

    const role = auth.staff?.role as string | undefined;
    const isPrivileged = role === 'Admin' || role === 'Manager';
    const staffId = requestedStaffId && isPrivileged ? requestedStaffId : auth.staff.id;

    if (requestedStaffId && !isPrivileged && requestedStaffId !== auth.staff.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const record = await endBreakForStaff(staffId);
    return NextResponse.json(record);
  } catch (error: any) {
    console.error('[API:ATTENDANCE_BREAK_END]', error);
    const message = error?.message || 'Failed to end break';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

