import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { editAttendanceRecord, getAttendanceEditLogs } from '@/server/modules/attendance';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { allowed } = await enforcePermission('attendance', 'read');
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const logs = await getAttendanceEditLogs(id);
    const mapped = logs.map((log: any) => ({
      id: log.id,
      attendanceId: log.attendanceId,
      editedByName: log.editedBy?.name || 'Unknown',
      reason: log.reason,
      oldCheckIn: log.oldCheckIn?.toISOString(),
      newCheckIn: log.newCheckIn?.toISOString(),
      oldCheckOut: log.oldCheckOut?.toISOString(),
      newCheckOut: log.newCheckOut?.toISOString(),
      oldStatus: log.oldStatus,
      newStatus: log.newStatus,
      oldInactiveDuration: log.oldInactiveDuration,
      newInactiveDuration: log.newInactiveDuration,
      oldOvertimeMinutes: log.oldOvertimeMinutes,
      newOvertimeMinutes: log.newOvertimeMinutes,
      createdAt: log.createdAt?.toISOString(),
    }));
    return NextResponse.json(mapped);
  } catch (error: any) {
    console.error('[API:ATTENDANCE_EDIT_LOG_GET]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { allowed } = await enforcePermission('attendance', 'update');
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();

    const result = await editAttendanceRecord({
      attendanceId: id,
      editedById: auth.staff.id,
      reason: body.reason || 'Manual edit',
      newCheckIn: body.checkInTime ? new Date(body.checkInTime) : undefined,
      newCheckOut: body.checkOutTime ? new Date(body.checkOutTime) : undefined,
      newStatus: body.status || undefined,
      newInactiveDuration: body.newInactiveDuration !== undefined ? body.newInactiveDuration : undefined,
      newOvertimeMinutes: body.newOvertimeMinutes !== undefined ? body.newOvertimeMinutes : undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API:ATTENDANCE_EDIT_POST]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
