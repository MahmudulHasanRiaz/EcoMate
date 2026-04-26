import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { approveLeaveRequest, rejectLeaveRequest, cancelLeaveRequest } from '@/server/modules/leaves';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    if (action === 'approve') {
      const { allowed } = await enforcePermission('attendance', 'update');
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const result = await approveLeaveRequest(id, auth.staff.id, auth.staff.role as string);
      return NextResponse.json(result);
    }

    if (action === 'reject') {
      const { allowed } = await enforcePermission('attendance', 'update');
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const result = await rejectLeaveRequest(id, auth.staff.id);
      return NextResponse.json(result);
    }

    if (action === 'cancel') {
      const result = await cancelLeaveRequest(id, auth.staff.id);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[API:LEAVES_ACTION]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
