import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { listLeaveRequests, submitLeaveRequest, listLeaveTypes, createLeaveType, updateLeaveType, getLeaveBalances } from '@/server/modules/leaves';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view'); // 'types' | 'balance' | 'requests'

    if (view === 'types') {
      const all = searchParams.get('all') === 'true';
      const types = await listLeaveTypes(all);
      return NextResponse.json(types);
    }

    if (view === 'balance') {
      const staffId = searchParams.get('staffId') || auth.staff.id;
      const year = Number(searchParams.get('year')) || new Date().getFullYear();
      
      const role = (auth.staff.role as string).toLowerCase();
      const isPrivileged = role === 'admin' || role.includes('manager');
      if (!isPrivileged && staffId !== auth.staff.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      const balances = await getLeaveBalances(staffId, year);
      return NextResponse.json(balances);
    }

    // Default: list leave requests
    const role = (auth.staff.role as string).toLowerCase();
    const isPrivileged = role === 'admin' || role.includes('manager');
    const staffId = isPrivileged ? (searchParams.get('staffId') || undefined) : auth.staff.id;
    const status = searchParams.get('status') || undefined;
    const year = searchParams.get('year') ? Number(searchParams.get('year')) : undefined;

    const requests = await listLeaveRequests({ staffId, status, year });
    const mapped = requests.map((r: any) => ({
      id: r.id,
      staffId: r.staffId,
      staffName: r.staff?.name || 'Unknown',
      staffRole: r.staff?.role,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveType?.name || 'Unknown',
      isPaid: r.leaveType?.isPaid ?? true,
      fromDate: r.fromDate?.toISOString(),
      toDate: r.toDate?.toISOString(),
      days: r.days,
      reason: r.reason,
      status: r.status,
      managerApprovedAt: r.managerApprovedAt?.toISOString(),
      adminApprovedAt: r.adminApprovedAt?.toISOString(),
      rejectedAt: r.rejectedAt?.toISOString(),
      createdAt: r.createdAt?.toISOString(),
    }));
    return NextResponse.json(mapped);
  } catch (error: any) {
    console.error('[API:LEAVES_GET]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === 'createType') {
      const { allowed } = await enforcePermission('attendance', 'create');
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const result = await createLeaveType(body);
      return NextResponse.json(result);
    }

    if (action === 'updateType') {
      const { allowed } = await enforcePermission('attendance', 'update');
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const { id, action: _action, ...data } = body;
      const result = await updateLeaveType(id, data);
      return NextResponse.json(result);
    }

    // Default: submit leave request
    const result = await submitLeaveRequest(auth.staff.id, {
      leaveTypeId: body.leaveTypeId,
      fromDate: body.fromDate,
      toDate: body.toDate,
      days: body.days,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API:LEAVES_POST]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
